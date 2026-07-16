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
import { DEFAULT_BRANCH, toGitSignature } from "./repo";
import type { CommitAuthor } from "./types";

/**
 * Whole-wiki versions ("snapshots") are plain branches under `version/<name>`.
 * The branch tip is a dedicated snapshot commit (same tree as the source
 * branch, parented on its tip) so the committer timestamp records *when the
 * version was taken*, not when content last changed, and the message records
 * who/why. Content reads never scan these branches — user-draft resolution
 * only looks at `user/*` (see `getLatestSourcePageAtRef`).
 */
const VERSION_BRANCH_PREFIX = "version/";

export function versionBranchName(name: string): string {
  return `${VERSION_BRANCH_PREFIX}${name}`;
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
  /** Snapshot commit oid — its tree is the whole wiki at snapshot time. */
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
  /** False when the branch already matches the version — no commit was made. */
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

/**
 * Snapshots `fromRef` (default: main; also accepts a full commit oid, e.g. an
 * older main commit picked from `listWikiCommits`) as version `name`. Write
 * operation — callers must run it through the repo's write lock.
 */
export async function createWikiVersion(
  gitdir: string,
  name: string,
  author: CommitAuthor,
  fromRef: string = DEFAULT_BRANCH,
): Promise<WikiVersion> {
  if (!isValidVersionName(name)) {
    throw new WikiVersionError(
      "Version names may only contain letters, digits, dots, dashes and underscores",
    );
  }
  const branchRef = `refs/heads/${versionBranchName(name)}`;
  if ((await resolveBranch(gitdir, branchRef)) !== null) {
    throw new WikiVersionError(`Version "${name}" already exists`);
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

  const signature = toGitSignature(author);
  const snapshotOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message: `Snapshot wiki version "${name}"`,
      tree: sourceTree,
      parent: [sourceOid],
      author: signature,
      committer: signature,
    },
  });
  await writeRef({ fs, gitdir, ref: branchRef, value: snapshotOid, force: true });

  return { name, oid: snapshotOid, createdAt: new Date(signature.timestamp * 1000) };
}

/**
 * Read-only. The commit history of `ref` (default: main), newest first — the
 * candidate commits an admin can snapshot as a version. `[]` if the ref is
 * missing (fresh repo).
 */
export async function listWikiCommits(
  gitdir: string,
  ref: string = DEFAULT_BRANCH,
  depth: number = 50,
): Promise<WikiCommit[]> {
  let entries;
  try {
    entries = await gitLog({ fs, gitdir, ref, depth });
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

/** Read-only. Newest first. */
export async function listWikiVersions(gitdir: string, branches: string[]): Promise<WikiVersion[]> {
  const versions: WikiVersion[] = [];
  for (const branch of branches) {
    if (!branch.startsWith(VERSION_BRANCH_PREFIX)) continue;
    const oid = await resolveBranch(gitdir, branch);
    if (!oid) continue;
    const { commit } = await readCommit({ fs, gitdir, oid });
    versions.push({
      name: branch.slice(VERSION_BRANCH_PREFIX.length),
      oid,
      createdAt: new Date(commit.committer.timestamp * 1000),
    });
  }
  return versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Restores `targetBranch` (default: main) to the tree of version `name`, as a
 * single new commit parented on the branch tip — history stays linear and the
 * pre-restore state remains reachable, so a restore can itself be undone by
 * restoring another version. Callers must reconcile Postgres page metadata
 * afterwards. Write operation — run through the repo's write lock.
 */
export async function restoreWikiVersion(
  gitdir: string,
  name: string,
  author: CommitAuthor,
  targetBranch: string = DEFAULT_BRANCH,
): Promise<RestoreVersionResult> {
  const versionOid = await resolveBranch(gitdir, `refs/heads/${versionBranchName(name)}`);
  if (!versionOid) {
    throw new WikiVersionError(`Version "${name}" does not exist`);
  }

  const beforeOid = await resolveRef({ fs, gitdir, ref: targetBranch });
  const versionTree = (await readCommit({ fs, gitdir, oid: versionOid })).commit.tree;
  const currentTree = (await readCommit({ fs, gitdir, oid: beforeOid })).commit.tree;
  if (versionTree === currentTree) {
    return { restored: false, beforeOid, afterOid: beforeOid };
  }

  const signature = toGitSignature(author);
  const afterOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message: `Restore wiki to version "${name}"`,
      tree: versionTree,
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
export async function deleteWikiVersion(gitdir: string, name: string): Promise<void> {
  const ref = `refs/heads/${versionBranchName(name)}`;
  if ((await resolveBranch(gitdir, ref)) === null) {
    throw new WikiVersionError(`Version "${name}" does not exist`);
  }
  await deleteRef({ fs, gitdir, ref });
}
