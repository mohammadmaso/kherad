import fs from "node:fs";
import path from "node:path";

import diff3Merge from "diff3";
import {
  findMergeBase,
  listFiles,
  merge as gitMerge,
  readBlob,
  readCommit,
  resolveRef,
  writeCommit,
  writeRef,
} from "isomorphic-git";

import {
  BINARY_CONFLICT_OURS,
  BINARY_CONFLICT_THEIRS,
} from "../binary-conflict";
import { isNotFoundError } from "./content";
import { EMPTY_TREE_OID, treeContentChanges } from "./diff";
import { isImageAssetPath } from "./paths";
import { SYSTEM_AUTHOR, toGitSignature } from "./repo";
import { resolveSubtreeOid } from "./subtree";
import { applyTreeChanges } from "./tree";
import type { ConflictFile, MergeResult } from "./types";

export {
  BINARY_CONFLICT_OURS,
  BINARY_CONFLICT_THEIRS,
  isBinaryConflictToken,
} from "../binary-conflict";

const CONFLICT_MARKER_SIZE = 7;
const LINEBREAKS = /^.*(\r?\n|$)/gm;

function parseBinaryResolutionSide(content: string): "ours" | "theirs" | null {
  const trimmed = content.trim();
  if (trimmed === BINARY_CONFLICT_OURS) return "ours";
  if (trimmed === BINARY_CONFLICT_THEIRS) return "theirs";
  // "keep both" concatenates the two tokens — prefer the incoming side.
  if (trimmed.includes(BINARY_CONFLICT_THEIRS) && trimmed.includes(BINARY_CONFLICT_OURS)) {
    return "theirs";
  }
  if (trimmed.includes(BINARY_CONFLICT_THEIRS)) return "theirs";
  if (trimmed.includes(BINARY_CONFLICT_OURS)) return "ours";
  return null;
}

function isBinaryBuffer(buf: Uint8Array): boolean {
  return buf.includes(0);
}

function binaryConflictMarkers(ourName: string, theirName: string): string {
  return (
    `${"<".repeat(CONFLICT_MARKER_SIZE)} ${ourName}\n` +
    `${BINARY_CONFLICT_OURS}\n` +
    `${"=".repeat(CONFLICT_MARKER_SIZE)}\n` +
    `${BINARY_CONFLICT_THEIRS}\n` +
    `${">".repeat(CONFLICT_MARKER_SIZE)} ${theirName}\n`
  );
}

function buffersEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Thrown by `squashMerge` when the two branches touch the same lines of the
 * same file(s). Carries the raw conflict-marker text per path so a manager
 * can resolve it (Prompt 9's conflict-resolution screen) and hand it back to
 * `resolveSquashMergeConflict` to finish the merge.
 */
export class MergeConflictDetectedError extends Error {
  readonly files: ConflictFile[];

  constructor(files: ConflictFile[]) {
    super(`Merge conflict in: ${files.map((f) => f.path).join(", ")}`);
    this.name = "MergeConflictDetectedError";
    this.files = files;
  }
}

function isMergeConflictError(
  err: unknown,
): err is Error & {
  data: { bothModified: string[]; deleteByUs: string[]; deleteByTheirs: string[] };
} {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "MergeConflictError"
  );
}

function splitLines(content: string): string[] {
  return content.match(LINEBREAKS) ?? [];
}

/**
 * Conflict markers must sit on their own lines. `splitLines` keeps the
 * trailing newline on every line *except* the last when the file (or a
 * conflict side) has no final `\n`, so naively concatenating
 * `side + "======="` produces glued lines like `` ```======= `` that the
 * resolution UI's line-oriented parser cannot see.
 */
function ensureTrailingNewline(text: string): string {
  if (text.length === 0 || text.endsWith("\n")) return text;
  return `${text}\n`;
}

/**
 * Re-implements isomorphic-git's default `mergeFile` driver (diff3 + the
 * same `<<<<<<<`/`=======`/`>>>>>>>` marker format) so we can invoke it
 * standalone — both to render conflict markers for display, and as the
 * fallback path inside our custom merge driver for files we weren't asked
 * to resolve.
 */
function diff3Markers(
  ourName: string,
  theirName: string,
  ourContent: string,
  baseContent: string,
  theirContent: string,
): { mergedText: string; cleanMerge: boolean } {
  const segments = diff3Merge(
    splitLines(ourContent),
    splitLines(baseContent),
    splitLines(theirContent),
  );

  let mergedText = "";
  let cleanMerge = true;
  for (const segment of segments) {
    if (segment.ok) {
      mergedText += segment.ok.join("");
    } else if (segment.conflict) {
      cleanMerge = false;
      mergedText = ensureTrailingNewline(mergedText);
      mergedText += `${"<".repeat(CONFLICT_MARKER_SIZE)} ${ourName}\n`;
      mergedText += ensureTrailingNewline(segment.conflict.a.join(""));
      mergedText += `${"=".repeat(CONFLICT_MARKER_SIZE)}\n`;
      mergedText += ensureTrailingNewline(segment.conflict.b.join(""));
      mergedText += `${">".repeat(CONFLICT_MARKER_SIZE)} ${theirName}\n`;
    }
  }
  return { mergedText, cleanMerge };
}

async function readBytesAtCommit(
  gitdir: string,
  commitOid: string,
  filepath: string,
): Promise<Uint8Array | null> {
  try {
    const { blob } = await readBlob({ fs, gitdir, oid: commitOid, filepath });
    return new Uint8Array(blob);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

async function readTextAtCommit(
  gitdir: string,
  commitOid: string,
  filepath: string,
): Promise<string> {
  const bytes = await readBytesAtCommit(gitdir, commitOid, filepath);
  return bytes ? Buffer.from(bytes).toString("utf8") : "";
}

function looksBinary(filepath: string, ...blobs: Array<Uint8Array | null>): boolean {
  if (isImageAssetPath(filepath)) return true;
  return blobs.some((blob) => blob !== null && isBinaryBuffer(blob));
}

async function buildConflictFiles(
  gitdir: string,
  paths: string[],
  ourOid: string,
  baseOid: string,
  theirOid: string,
  ourName: string,
  theirName: string,
): Promise<ConflictFile[]> {
  return Promise.all(
    paths.map(async (filepath) => {
      const [ourBytes, baseBytes, theirBytes] = await Promise.all([
        readBytesAtCommit(gitdir, ourOid, filepath),
        readBytesAtCommit(gitdir, baseOid, filepath),
        readBytesAtCommit(gitdir, theirOid, filepath),
      ]);

      if (looksBinary(filepath, ourBytes, baseBytes, theirBytes)) {
        return { path: filepath, markerText: binaryConflictMarkers(ourName, theirName) };
      }

      const ourContent = ourBytes ? Buffer.from(ourBytes).toString("utf8") : "";
      const baseContent = baseBytes ? Buffer.from(baseBytes).toString("utf8") : "";
      const theirContent = theirBytes ? Buffer.from(theirBytes).toString("utf8") : "";
      const { mergedText } = diff3Markers(
        ourName,
        theirName,
        ourContent,
        baseContent,
        theirContent,
      );
      return { path: filepath, markerText: mergedText };
    }),
  );
}

async function materializeResolutionContent(
  gitdir: string,
  filepath: string,
  resolvedText: string,
  oursCommitOid: string,
  theirsCommitOid: string,
): Promise<string | Uint8Array> {
  const side = parseBinaryResolutionSide(resolvedText);
  if (side === null) return resolvedText;
  const oid = side === "theirs" ? theirsCommitOid : oursCommitOid;
  const bytes = await readBytesAtCommit(gitdir, oid, filepath);
  return bytes ?? new Uint8Array();
}

async function finalizeSquashCommit(
  gitdir: string,
  targetOid: string,
  targetBranch: string,
  mergedTreeOid: string,
  message: string,
): Promise<MergeResult> {
  const signature = toGitSignature(SYSTEM_AUTHOR);
  const squashCommitOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message,
      tree: mergedTreeOid,
      parent: [targetOid],
      author: signature,
      committer: signature,
    },
  });

  await writeRef({
    fs,
    gitdir,
    ref: targetBranch.startsWith("refs/") ? targetBranch : `refs/heads/${targetBranch}`,
    value: squashCommitOid,
    force: true,
  });

  return { oid: squashCommitOid, alreadyMerged: false };
}

/**
 * isomorphic-git's `merge()` writes conflicted (multi-stage) entries into the
 * on-disk index *before* throwing `MergeConflictError`, and never cleans
 * them up — the next `merge()` call refuses to even start
 * (`UnmergedPathsError`) until something clears it. Nothing in this git
 * engine reads the index (all reads/writes go through explicit oids/refs via
 * plumbing commands), so it's safe to drop after every attempt rather than
 * carry stale state between merges.
 */
async function resetIndexFile(gitdir: string): Promise<void> {
  await fs.promises.rm(path.join(gitdir, "index"), { force: true });
}

function treeOidFromMergeResult(
  gitdir: string,
  result: { oid?: string; tree?: string },
): Promise<string> | string {
  if (result.tree) return result.tree;
  if (!result.oid) {
    throw new Error("Merge produced no result oid");
  }
  return readCommit({ fs, gitdir, oid: result.oid }).then((c) => c.commit.tree);
}

async function subtreeOidOrEmpty(
  gitdir: string,
  treeOid: string,
  pathPrefix: string,
): Promise<string> {
  return (await resolveSubtreeOid(gitdir, treeOid, pathPrefix)) ?? EMPTY_TREE_OID;
}

/**
 * Wraps a tree oid in a throwaway commit (never referenced by a ref, not
 * part of permanent history) purely so isomorphic-git's `merge()` — which
 * operates on commits, not bare trees — can run its real 3-way merge/conflict
 * machinery against a *subtree* as if it were the whole repo.
 */
async function writeSyntheticCommit(
  gitdir: string,
  treeOid: string,
  parent: string[],
  signature: ReturnType<typeof toGitSignature>,
): Promise<string> {
  return writeCommit({
    fs,
    gitdir,
    commit: {
      message: "(scoped merge scratch)",
      tree: treeOid,
      parent,
      author: signature,
      committer: signature,
    },
  });
}

type ScopedMergeSetup = {
  targetOid: string;
  targetTreeOid: string;
  oursSubtreeOid: string;
  oursCommitOid: string;
  theirsCommitOid: string;
  baseCommitOid: string;
};

/**
 * Resolves everything needed to run a merge scoped to `pathPrefix` (e.g. a
 * single bundle's `wiki/<slug>` subtree) instead of the whole repo tree:
 * extracts the base/ours/theirs subtree at that prefix from the real
 * base/target/source commits, then wraps each in a synthetic commit with
 * proper base→ours/base→theirs ancestry so `merge()`'s own
 * `findMergeBase` resolves correctly.
 */
async function prepareScopedMerge(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  pathPrefix: string,
  signature: ReturnType<typeof toGitSignature>,
): Promise<ScopedMergeSetup> {
  const targetOid = await resolveRef({ fs, gitdir, ref: targetBranch });
  const sourceOid = await resolveRef({ fs, gitdir, ref: sourceBranch });
  const [baseOid] = await findMergeBase({ fs, gitdir, oids: [targetOid, sourceOid] });
  if (!baseOid) {
    throw new Error(`No common ancestor between '${sourceBranch}' and '${targetBranch}'`);
  }

  const [targetTreeOid, sourceTreeOid, baseTreeOid] = await Promise.all([
    readCommit({ fs, gitdir, oid: targetOid }).then((c) => c.commit.tree),
    readCommit({ fs, gitdir, oid: sourceOid }).then((c) => c.commit.tree),
    readCommit({ fs, gitdir, oid: baseOid }).then((c) => c.commit.tree),
  ]);

  const [oursSubtreeOid, theirsSubtreeOid, baseSubtreeOid] = await Promise.all([
    subtreeOidOrEmpty(gitdir, targetTreeOid, pathPrefix),
    subtreeOidOrEmpty(gitdir, sourceTreeOid, pathPrefix),
    subtreeOidOrEmpty(gitdir, baseTreeOid, pathPrefix),
  ]);

  const baseCommitOid = await writeSyntheticCommit(gitdir, baseSubtreeOid, [], signature);
  const oursCommitOid = await writeSyntheticCommit(
    gitdir,
    oursSubtreeOid,
    [baseCommitOid],
    signature,
  );
  const theirsCommitOid = await writeSyntheticCommit(
    gitdir,
    theirsSubtreeOid,
    [baseCommitOid],
    signature,
  );

  return {
    targetOid,
    targetTreeOid,
    oursSubtreeOid,
    oursCommitOid,
    theirsCommitOid,
    baseCommitOid,
  };
}

/**
 * Diffs the merged subtree result against the subtree's pre-merge state to
 * get a flat set of blob writes, then splices just those writes into the
 * *real* target tree at `pathPrefix` — every path outside the bundle's
 * subtree is left byte-for-byte as it was on `targetBranch`, regardless of
 * what the source branch (which may span other bundles, since it's one
 * branch per user, not per bundle) looks like elsewhere.
 */
async function spliceAndFinalize(
  gitdir: string,
  targetOid: string,
  targetTreeOid: string,
  targetBranch: string,
  pathPrefix: string,
  oursSubtreeOid: string,
  mergedSubtreeOid: string,
  message: string,
): Promise<MergeResult> {
  const changes = await treeContentChanges(gitdir, oursSubtreeOid, mergedSubtreeOid);
  if (changes.size === 0) {
    return { oid: targetOid, alreadyMerged: true };
  }

  const prefixedChanges = new Map<string, string | Uint8Array | null>(
    [...changes].map(([relPath, content]) => [`${pathPrefix}/${relPath}`, content]),
  );
  const splicedTreeOid = await applyTreeChanges(gitdir, targetTreeOid, prefixedChanges);
  return finalizeSquashCommit(gitdir, targetOid, targetBranch, splicedTreeOid, message);
}

async function squashMergeWholeTree(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  signature: ReturnType<typeof toGitSignature>,
): Promise<MergeResult> {
  const targetOid = await resolveRef({ fs, gitdir, ref: targetBranch });

  let result: { oid?: string; tree?: string; alreadyMerged?: boolean };
  try {
    result = await gitMerge({
      fs,
      gitdir,
      ours: targetBranch,
      theirs: sourceBranch,
      fastForward: true,
      noUpdateBranch: true,
      message,
      author: signature,
      committer: signature,
    });
  } catch (err) {
    if (!isMergeConflictError(err)) throw err;

    const { bothModified, deleteByUs, deleteByTheirs } = err.data;
    if (deleteByUs.length > 0 || deleteByTheirs.length > 0) {
      await resetIndexFile(gitdir);
      throw new Error(
        `Merge conflict involves a file deleted on one branch and modified on the other ` +
          `(${[...deleteByUs, ...deleteByTheirs].join(", ")}) — not supported by automatic conflict resolution.`,
      );
    }

    const theirOid = await resolveRef({ fs, gitdir, ref: sourceBranch });
    const [baseOid] = await findMergeBase({ fs, gitdir, oids: [targetOid, theirOid] });
    if (!baseOid) {
      await resetIndexFile(gitdir);
      throw err;
    }

    const files = await buildConflictFiles(
      gitdir,
      bothModified,
      targetOid,
      baseOid,
      theirOid,
      targetBranch,
      sourceBranch,
    );
    await resetIndexFile(gitdir);
    throw new MergeConflictDetectedError(files);
  }

  await resetIndexFile(gitdir);

  if (result.alreadyMerged) {
    return { oid: targetOid, alreadyMerged: true };
  }

  const mergedTreeOid = await treeOidFromMergeResult(gitdir, result);
  return finalizeSquashCommit(gitdir, targetOid, targetBranch, mergedTreeOid, message);
}

async function squashMergeScoped(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  pathPrefix: string,
  signature: ReturnType<typeof toGitSignature>,
): Promise<MergeResult> {
  const {
    targetOid,
    targetTreeOid,
    oursSubtreeOid,
    oursCommitOid,
    theirsCommitOid,
    baseCommitOid,
  } = await prepareScopedMerge(gitdir, sourceBranch, targetBranch, pathPrefix, signature);

  let result: { oid?: string; tree?: string; alreadyMerged?: boolean };
  try {
    result = await gitMerge({
      fs,
      gitdir,
      ours: oursCommitOid,
      theirs: theirsCommitOid,
      fastForward: true,
      noUpdateBranch: true,
      message,
      author: signature,
      committer: signature,
    });
  } catch (err) {
    if (!isMergeConflictError(err)) {
      await resetIndexFile(gitdir);
      throw err;
    }

    const { bothModified, deleteByUs, deleteByTheirs } = err.data;
    if (deleteByUs.length > 0 || deleteByTheirs.length > 0) {
      await resetIndexFile(gitdir);
      throw new Error(
        `Merge conflict involves a file deleted on one branch and modified on the other ` +
          `(${[...deleteByUs, ...deleteByTheirs].map((p) => `${pathPrefix}/${p}`).join(", ")}) — not supported by automatic conflict resolution.`,
      );
    }

    const files = await buildConflictFiles(
      gitdir,
      bothModified,
      oursCommitOid,
      baseCommitOid,
      theirsCommitOid,
      targetBranch,
      sourceBranch,
    );
    await resetIndexFile(gitdir);
    throw new MergeConflictDetectedError(
      files.map((f) => ({ ...f, path: `${pathPrefix}/${f.path}` })),
    );
  }

  await resetIndexFile(gitdir);

  if (result.alreadyMerged) {
    return { oid: targetOid, alreadyMerged: true };
  }

  const mergedSubtreeOid = await treeOidFromMergeResult(gitdir, result);
  return spliceAndFinalize(
    gitdir,
    targetOid,
    targetTreeOid,
    targetBranch,
    pathPrefix,
    oursSubtreeOid,
    mergedSubtreeOid,
    message,
  );
}

/**
 * Squash-merges `sourceBranch` into `targetBranch`: computes a real 3-way
 * merge tree (so unrelated changes already on `targetBranch` are preserved),
 * then writes that tree as a single new commit with `targetBranch`'s old head
 * as its only parent — a linear, single-parent "squash merge" rather than a
 * two-parent merge commit. This is a write operation — callers must run it
 * through the repo's write lock.
 *
 * `pathPrefix`, when given, scopes *everything* — conflict detection and the
 * final written tree — to that subtree (e.g. one bundle's `wiki/<slug>`).
 * This matters because branches are one-per-user, not one-per-bundle: a
 * user's branch can carry edits to several bundles at once, and without
 * scoping, approving one bundle's merge request would 3-way-merge (and can
 * spuriously conflict on) completely unrelated bundles' content that
 * happens to also differ between the branches. Omitting it merges the whole
 * repo tree, which is only appropriate outside the multi-bundle wiki (e.g.
 * tests against a single-purpose repo).
 *
 * Throws `MergeConflictDetectedError` (carrying raw markers, `path` always
 * prefixed with `pathPrefix` when scoped) when both branches touch the same
 * lines of the same file — the reviewer/manager resolves it via
 * `resolveSquashMergeConflict`, per PRD §3.
 */
export async function squashMerge(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  pathPrefix?: string,
): Promise<MergeResult> {
  const signature = toGitSignature(SYSTEM_AUTHOR);
  return pathPrefix
    ? squashMergeScoped(gitdir, sourceBranch, targetBranch, message, pathPrefix, signature)
    : squashMergeWholeTree(gitdir, sourceBranch, targetBranch, message, signature);
}

async function resolveSquashMergeConflictWholeTree(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  resolutions: { path: string; content: string }[],
): Promise<MergeResult> {
  // Walk the full tree ourselves (same strategy as scoped resolve). isomorphic-git's
  // `mergeDriver` is not invoked for binary blobs, so a driver-based second pass
  // cannot materialize image resolutions and still throws MergeConflictError.
  const targetOid = await resolveRef({ fs, gitdir, ref: targetBranch });
  const theirOid = await resolveRef({ fs, gitdir, ref: sourceBranch });
  const [baseOid] = await findMergeBase({ fs, gitdir, oids: [targetOid, theirOid] });
  if (!baseOid) {
    throw new Error(`No common ancestor between '${sourceBranch}' and '${targetBranch}'`);
  }

  const targetTreeOid = (await readCommit({ fs, gitdir, oid: targetOid })).commit.tree;
  const resolutionMap = new Map(resolutions.map((r) => [r.path, r.content]));
  const mergedTreeOid = await buildResolvedSubtreeOid(
    gitdir,
    targetTreeOid,
    targetOid,
    theirOid,
    baseOid,
    resolutionMap,
    targetBranch,
    sourceBranch,
  );

  if (mergedTreeOid === targetTreeOid) {
    return { oid: targetOid, alreadyMerged: true };
  }

  return finalizeSquashCommit(gitdir, targetOid, targetBranch, mergedTreeOid, message);
}

function normalizeScopedResolutionPath(filePath: string, pathPrefix: string): string {
  const prefix = `${pathPrefix}/`;
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  return filePath;
}

/**
 * Builds the merged subtree for a scoped conflict resolution without calling
 * `git.merge()`'s `mergeDriver` — isomorphic-git does not invoke the driver
 * reliably when `ours`/`theirs` are synthetic commit oids (only branch refs).
 */
async function buildResolvedSubtreeOid(
  gitdir: string,
  oursSubtreeOid: string,
  oursCommitOid: string,
  theirsCommitOid: string,
  baseCommitOid: string,
  resolutionMap: Map<string, string>,
  ourName: string,
  theirName: string,
): Promise<string> {
  const [oursPaths, theirsPaths] = await Promise.all([
    listFiles({ fs, gitdir, ref: oursCommitOid }),
    listFiles({ fs, gitdir, ref: theirsCommitOid }),
  ]);
  const allPaths = new Set([...oursPaths, ...theirsPaths]);
  const changes = new Map<string, string | Uint8Array | null>();

  for (const filepath of allPaths) {
    const resolved = resolutionMap.get(filepath);
    if (resolved !== undefined) {
      changes.set(
        filepath,
        await materializeResolutionContent(
          gitdir,
          filepath,
          resolved,
          oursCommitOid,
          theirsCommitOid,
        ),
      );
      continue;
    }

    const [ourBytes, baseBytes, theirBytes] = await Promise.all([
      readBytesAtCommit(gitdir, oursCommitOid, filepath),
      readBytesAtCommit(gitdir, baseCommitOid, filepath),
      readBytesAtCommit(gitdir, theirsCommitOid, filepath),
    ]);

    if (looksBinary(filepath, ourBytes, baseBytes, theirBytes)) {
      if (buffersEqual(ourBytes, theirBytes)) continue;
      if (buffersEqual(theirBytes, baseBytes)) continue; // keep ours
      if (buffersEqual(ourBytes, baseBytes)) {
        changes.set(filepath, theirBytes);
        continue;
      }
      throw new MergeConflictDetectedError([
        { path: filepath, markerText: binaryConflictMarkers(ourName, theirName) },
      ]);
    }

    const ourContent = ourBytes ? Buffer.from(ourBytes).toString("utf8") : "";
    const baseContent = baseBytes ? Buffer.from(baseBytes).toString("utf8") : "";
    const theirContent = theirBytes ? Buffer.from(theirBytes).toString("utf8") : "";

    const { mergedText, cleanMerge } = diff3Markers(
      ourName,
      theirName,
      ourContent,
      baseContent,
      theirContent,
    );
    if (!cleanMerge) {
      const files = await buildConflictFiles(
        gitdir,
        [filepath],
        oursCommitOid,
        baseCommitOid,
        theirsCommitOid,
        ourName,
        theirName,
      );
      const file = files[0];
      if (!file) throw new Error(`Failed to build conflict markers for ${filepath}`);
      throw new MergeConflictDetectedError([file]);
    }

    if (mergedText === ourContent) continue;

    if (mergedText === "" && ourContent !== "" && theirContent === "") {
      changes.set(filepath, null);
      continue;
    }

    changes.set(filepath, mergedText);
  }

  return applyTreeChanges(gitdir, oursSubtreeOid, changes);
}

async function resolveSquashMergeConflictScoped(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  resolutions: { path: string; content: string }[],
  pathPrefix: string,
  signature: ReturnType<typeof toGitSignature>,
): Promise<MergeResult> {
  const { targetOid, targetTreeOid, oursSubtreeOid, oursCommitOid, theirsCommitOid, baseCommitOid } =
    await prepareScopedMerge(gitdir, sourceBranch, targetBranch, pathPrefix, signature);

  const resolutionMap = new Map(
    resolutions.map((r) => [normalizeScopedResolutionPath(r.path, pathPrefix), r.content]),
  );

  let mergedSubtreeOid: string;
  try {
    mergedSubtreeOid = await buildResolvedSubtreeOid(
      gitdir,
      oursSubtreeOid,
      oursCommitOid,
      theirsCommitOid,
      baseCommitOid,
      resolutionMap,
      targetBranch,
      sourceBranch,
    );
  } catch (err) {
    if (err instanceof MergeConflictDetectedError) {
      throw new MergeConflictDetectedError(
        err.files.map((f) => ({ ...f, path: `${pathPrefix}/${f.path}` })),
      );
    }
    throw err;
  }

  return spliceAndFinalize(
    gitdir,
    targetOid,
    targetTreeOid,
    targetBranch,
    pathPrefix,
    oursSubtreeOid,
    mergedSubtreeOid,
    message,
  );
}

/**
 * Completes a squash-merge a manager previously saw fail with
 * `MergeConflictDetectedError`, substituting their final (marker-free) text
 * for each conflicting path while re-running the same 3-way merge for every
 * other file. `pathPrefix` must match whatever `squashMerge` used to produce
 * the conflict being resolved (resolution `path`s are matched with or
 * without that prefix). This is a write operation — callers must run it
 * through the repo's write lock.
 */
export async function resolveSquashMergeConflict(
  gitdir: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  resolutions: { path: string; content: string }[],
  pathPrefix?: string,
): Promise<MergeResult> {
  const signature = toGitSignature(SYSTEM_AUTHOR);
  return pathPrefix
    ? resolveSquashMergeConflictScoped(
        gitdir,
        sourceBranch,
        targetBranch,
        message,
        resolutions,
        pathPrefix,
        signature,
      )
    : resolveSquashMergeConflictWholeTree(
        gitdir,
        sourceBranch,
        targetBranch,
        message,
        resolutions,
      );
}
