import fs from "node:fs";

import {
  deleteRef,
  log as gitLog,
  readCommit,
  resolveRef,
  writeCommit,
  writeRef,
} from "isomorphic-git";

import { isNotFoundError } from "./content";
import { bundleGitPathPrefix, legacyBundleGitPathPrefix, okfGitPathPrefix } from "./paths";
import { DEFAULT_BRANCH, toGitSignature } from "./repo";
import { graftSubtree, resolveSubtreeOid } from "./subtree";
import type { CommitAuthor } from "./types";

/**
 * Per-bundle versions ("snapshots") are plain branches under
 * `version/<bundleSlug>/<name>`. The branch tip's tree keeps the same shape
 * as `main` (content still lives at `raw/<bundleSlug>/…` etc.) but contains
 * *only* that bundle's subtrees — every other bundle's content is pruned
 * out. Keeping main's path shape (rather than re-rooting) lets the
 * reader-facing version viewer (`resolveWikiPage` / `getWikiNavForVersion`
 * in apps/web) read a version branch with the exact same path helpers
 * (`getSourcePageAtRef`, `okfDocGitPath`, …) it already uses for `main`.
 * The commit is a dedicated snapshot commit (parented on the source commit
 * for traceability) so the committer timestamp records *when the version was
 * taken*, not when content last changed. Content reads never scan these
 * branches — user-draft resolution only looks at `user/*` (see
 * `getLatestSourcePageAtRef`).
 */
const VERSION_BRANCH_PREFIX = "version/";

/**
 * Every git prefix that belongs to one bundle and therefore falls inside its
 * version scope: current source pages (`raw/<slug>`), pre-migration source
 * pages (`wiki/<slug>` — older commits, or pages never re-saved since the
 * `raw/` migration, may only exist there), and the compiled OKF knowledge
 * bundle (`okf/<slug>` — what the public wiki actually renders for
 * `llm_compiled` bundles, so a snapshot without it would read as empty).
 */
function bundleVersionPathPrefixes(bundleSlug: string): string[] {
  return [
    bundleGitPathPrefix(bundleSlug),
    legacyBundleGitPathPrefix(bundleSlug),
    okfGitPathPrefix(bundleSlug),
  ];
}

export function bundleVersionBranchName(bundleSlug: string, name: string): string {
  return `${VERSION_BRANCH_PREFIX}${bundleSlug}/${name}`;
}

/** One git ref-component: letters/digits plus `. _ -`, no leading dot, no `..`, no `.lock` suffix. */
export function isValidVersionName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
  if (name.includes("..") || name.endsWith(".lock") || name.endsWith(".")) return false;
  return true;
}

export class WikiVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiVersionError";
  }
}

export type WikiVersion = {
  name: string;
  /** Snapshot commit oid — its tree is the bundle's content at snapshot time. */
  oid: string;
  createdAt: Date;
};

export type WikiCommit = {
  oid: string;
  /** First line of the commit message. */
  summary: string;
  authorName: string;
  committedAt: Date;
};

export type RestoreVersionResult = {
  /** False when the branch's bundle subtrees already match the version — no commit was made. */
  restored: boolean;
  beforeOid: string;
  afterOid: string;
};

async function resolveBranch(gitdir: string, ref: string): Promise<string | null> {
  try {
    return await resolveRef({ fs, gitdir, ref });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** The bundle's subtree oid at each version-scoped prefix (null where absent). */
async function resolveBundleSubtrees(
  gitdir: string,
  rootTreeOid: string,
  prefixes: string[],
): Promise<Array<string | null>> {
  return Promise.all(prefixes.map((prefix) => resolveSubtreeOid(gitdir, rootTreeOid, prefix)));
}

/**
 * Snapshots `bundleSlug`'s content at `fromRef` (default: main; also accepts
 * a full commit oid, e.g. an older commit picked from
 * `listBundleWikiCommits`) as version `name`, scoped to that bundle's
 * subtrees only (see `bundleVersionPathPrefixes`) — every other bundle's
 * content is left out of the snapshot entirely. Write operation — callers
 * must run it through the repo's write lock.
 */
export async function createBundleWikiVersion(
  gitdir: string,
  bundleSlug: string,
  name: string,
  author: CommitAuthor,
  fromRef: string = DEFAULT_BRANCH,
): Promise<WikiVersion> {
  if (!isValidVersionName(name)) {
    throw new WikiVersionError(
      "Version names may only contain letters, digits, dots, dashes and underscores",
    );
  }
  const branchRef = `refs/heads/${bundleVersionBranchName(bundleSlug, name)}`;
  if ((await resolveBranch(gitdir, branchRef)) !== null) {
    throw new WikiVersionError(`Version "${name}" already exists for this bundle`);
  }

  let sourceOid: string;
  let sourceTree: string;
  try {
    sourceOid = await resolveRef({ fs, gitdir, ref: fromRef });
    sourceTree = (await readCommit({ fs, gitdir, oid: sourceOid })).commit.tree;
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new WikiVersionError(`Commit "${fromRef}" does not exist`);
    }
    throw err;
  }

  const prefixes = bundleVersionPathPrefixes(bundleSlug);
  const subtreeOids = await resolveBundleSubtrees(gitdir, sourceTree, prefixes);

  // Prune everything but this bundle's subtrees, keeping main's path shape
  // so the snapshot reads with the same helpers as main.
  let snapshotTree: string | undefined;
  for (const [i, prefix] of prefixes.entries()) {
    const subtreeOid = subtreeOids[i];
    if (subtreeOid == null) continue;
    snapshotTree = await graftSubtree(
      gitdir,
      snapshotTree,
      prefix.split("/").filter(Boolean),
      subtreeOid,
    );
  }
  if (!snapshotTree) {
    throw new WikiVersionError("This bundle has no pages to snapshot yet");
  }

  const signature = toGitSignature(author);
  const snapshotOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message: `Snapshot bundle "${bundleSlug}" version "${name}"`,
      tree: snapshotTree,
      parent: [sourceOid],
      author: signature,
      committer: signature,
    },
  });
  await writeRef({ fs, gitdir, ref: branchRef, value: snapshotOid, force: true });

  return { name, oid: snapshotOid, createdAt: new Date(signature.timestamp * 1000) };
}

async function logForPrefix(
  gitdir: string,
  ref: string,
  filepath: string,
  depth: number,
): Promise<WikiCommit[]> {
  let entries;
  try {
    entries = await gitLog({ fs, gitdir, ref, filepath, depth });
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
  return entries.map(({ oid, commit }) => ({
    oid,
    summary: commit.message.split("\n", 1)[0] ?? "",
    authorName: commit.author.name,
    committedAt: new Date(commit.committer.timestamp * 1000),
  }));
}

/**
 * Read-only. The commit history of `ref` (default: main) that touched
 * `bundleSlug`'s content, newest first — the candidate commits an
 * admin/manager can snapshot as a version. Merges history across every
 * version-scoped prefix (`raw/<slug>`, legacy `wiki/<slug>`, `okf/<slug>` —
 * see `bundleVersionPathPrefixes`), since a commit may touch only one of
 * them. `[]` if the ref is missing (fresh repo) or the bundle has no commits
 * yet.
 */
export async function listBundleWikiCommits(
  gitdir: string,
  bundleSlug: string,
  ref: string = DEFAULT_BRANCH,
  depth: number = 50,
): Promise<WikiCommit[]> {
  const perPrefix = await Promise.all(
    bundleVersionPathPrefixes(bundleSlug).map((prefix) =>
      logForPrefix(gitdir, ref, prefix, depth),
    ),
  );

  const byOid = new Map<string, WikiCommit>();
  for (const commit of perPrefix.flat()) {
    if (!byOid.has(commit.oid)) byOid.set(commit.oid, commit);
  }

  return Array.from(byOid.values())
    .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
    .slice(0, depth);
}

/** Read-only. Newest first. Every `version/<bundleSlug>/*` snapshot for this bundle. */
export async function listBundleWikiVersions(
  gitdir: string,
  branches: string[],
  bundleSlug: string,
): Promise<WikiVersion[]> {
  const prefix = `${VERSION_BRANCH_PREFIX}${bundleSlug}/`;
  const versions: WikiVersion[] = [];
  for (const branch of branches) {
    if (!branch.startsWith(prefix)) continue;
    const oid = await resolveBranch(gitdir, branch);
    if (!oid) continue;
    const { commit } = await readCommit({ fs, gitdir, oid });
    versions.push({
      name: branch.slice(prefix.length),
      oid,
      createdAt: new Date(commit.committer.timestamp * 1000),
    });
  }
  return versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Restores `bundleSlug`'s content on `targetBranch` (default: main) to the
 * tree of version `name`, as a single new commit parented on the branch tip
 * — every other bundle's content is left byte-for-byte unchanged. Each
 * version-scoped prefix (`raw/<slug>`, legacy `wiki/<slug>`, `okf/<slug>`)
 * is reset (or cleared, if the version has nothing there) independently, so
 * restoring can't leave a stale copy under a prefix the snapshot didn't
 * have. History stays linear and the pre-restore state remains reachable, so
 * a restore can itself be undone by restoring another version. Callers must
 * reconcile Postgres page metadata + OKF search index for this bundle
 * afterwards. Write operation — run through the repo's write lock.
 */
export async function restoreBundleWikiVersion(
  gitdir: string,
  bundleSlug: string,
  name: string,
  author: CommitAuthor,
  targetBranch: string = DEFAULT_BRANCH,
): Promise<RestoreVersionResult> {
  const versionOid = await resolveBranch(
    gitdir,
    `refs/heads/${bundleVersionBranchName(bundleSlug, name)}`,
  );
  if (!versionOid) {
    throw new WikiVersionError(`Version "${name}" does not exist for this bundle`);
  }

  const beforeOid = await resolveRef({ fs, gitdir, ref: targetBranch });
  const prefixes = bundleVersionPathPrefixes(bundleSlug);

  const versionRootTree = (await readCommit({ fs, gitdir, oid: versionOid })).commit.tree;
  const versionSubtreeOids = await resolveBundleSubtrees(gitdir, versionRootTree, prefixes);
  if (versionSubtreeOids.every((oid) => oid === null)) {
    throw new WikiVersionError(`Version "${name}" is missing this bundle's pages`);
  }

  const currentRootTree = (await readCommit({ fs, gitdir, oid: beforeOid })).commit.tree;
  const currentSubtreeOids = await resolveBundleSubtrees(gitdir, currentRootTree, prefixes);
  if (prefixes.every((_, i) => currentSubtreeOids[i] === versionSubtreeOids[i])) {
    return { restored: false, beforeOid, afterOid: beforeOid };
  }

  let newRootTree = currentRootTree;
  for (const [i, prefix] of prefixes.entries()) {
    newRootTree = await graftSubtree(
      gitdir,
      newRootTree,
      prefix.split("/").filter(Boolean),
      versionSubtreeOids[i] ?? null,
    );
  }

  const signature = toGitSignature(author);
  const afterOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message: `Restore bundle "${bundleSlug}" to version "${name}"`,
      tree: newRootTree,
      parent: [beforeOid],
      author: signature,
      committer: signature,
    },
  });
  await writeRef({
    fs,
    gitdir,
    ref: targetBranch.startsWith("refs/") ? targetBranch : `refs/heads/${targetBranch}`,
    value: afterOid,
    force: true,
  });

  return { restored: true, beforeOid, afterOid };
}

/** Write operation — run through the repo's write lock. */
export async function deleteBundleWikiVersion(
  gitdir: string,
  bundleSlug: string,
  name: string,
): Promise<void> {
  const ref = `refs/heads/${bundleVersionBranchName(bundleSlug, name)}`;
  if ((await resolveBranch(gitdir, ref)) === null) {
    throw new WikiVersionError(`Version "${name}" does not exist for this bundle`);
  }
  await deleteRef({ fs, gitdir, ref });
}
