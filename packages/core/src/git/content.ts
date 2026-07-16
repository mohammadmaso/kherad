import fs from "node:fs";

import {
  listFiles,
  readBlob,
  readCommit,
  readTree,
  resolveRef,
  writeCommit,
  writeRef,
} from "isomorphic-git";

import { DEFAULT_BRANCH, toGitSignature } from "./repo";
import { applyTreeChanges } from "./tree";
import type { CommitAuthor, FileWrite } from "./types";

export function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "NotFoundError"
  );
}

function refToFullRef(ref: string): string {
  return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

/** Read-only. Does not take the write lock. Returns `null` if the ref or path doesn't exist. */
export async function getFileAtRef(
  gitdir: string,
  ref: string,
  filepath: string,
): Promise<Uint8Array | null> {
  let oid: string;
  try {
    oid = await resolveRef({ fs, gitdir, ref });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }

  try {
    const { blob } = await readBlob({ fs, gitdir, oid, filepath });
    return blob;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Read-only. Does not take the write lock. Lists every blob path in the tree
 * at `ref`, optionally restricted to `pathPrefix` (a directory prefix, e.g.
 * `okf/<slug>`). Returns `[]` if the ref doesn't exist yet.
 */
export async function listFilesAtRef(
  gitdir: string,
  ref: string,
  pathPrefix?: string,
): Promise<string[]> {
  let paths: string[];
  try {
    paths = await listFiles({ fs, gitdir, ref });
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }

  if (!pathPrefix) return paths;
  return paths.filter((p) => p === pathPrefix || p.startsWith(`${pathPrefix}/`));
}

/** Read-only. Does not take the write lock. Returns `null` if the ref doesn't exist. */
export async function getLastCommitTimestamp(gitdir: string, ref: string): Promise<Date | null> {
  let oid: string;
  try {
    oid = await resolveRef({ fs, gitdir, ref });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }

  const { commit } = await readCommit({ fs, gitdir, oid });
  return new Date(commit.committer.timestamp * 1000);
}

/**
 * Writes one or more files (or deletes, via `content: null`) to `branch` in a
 * single commit. This is a write operation — callers must run it through the
 * repo's write lock.
 *
 * If `branch` does not exist yet, the new commit parents off `main` (and
 * starts from main's tree) so the branch shares history with the default
 * branch — required for `squashMerge` / `findMergeBase`.
 */
export async function writeAndCommit(
  gitdir: string,
  branchName: string,
  files: FileWrite[],
  message: string,
  author: CommitAuthor,
): Promise<string> {
  let parentOid: string | undefined;
  let baseTreeOid: string | undefined;
  try {
    parentOid = await resolveRef({ fs, gitdir, ref: branchName });
    baseTreeOid = (await readTree({ fs, gitdir, oid: parentOid })).oid;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Missing branch: fork from main rather than creating an orphan tip.
    parentOid = await resolveRef({ fs, gitdir, ref: DEFAULT_BRANCH });
    baseTreeOid = (await readTree({ fs, gitdir, oid: parentOid })).oid;
  }

  const changes = new Map<string, string | Uint8Array | null>(
    files.map((f) => [f.path, f.content]),
  );
  const newTreeOid = await applyTreeChanges(gitdir, baseTreeOid, changes);

  const signature = toGitSignature(author);
  const commitOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message,
      tree: newTreeOid,
      parent: parentOid ? [parentOid] : [],
      author: signature,
      committer: signature,
    },
  });

  await writeRef({ fs, gitdir, ref: refToFullRef(branchName), value: commitOid, force: true });

  return commitOid;
}
