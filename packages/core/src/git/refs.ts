import fs from "node:fs";

import {
  branch,
  findMergeBase,
  listBranches as gitListBranches,
  resolveRef,
  writeRef,
} from "isomorphic-git";

import { isNotFoundError } from "./content";
import { DEFAULT_BRANCH } from "./repo";

/** Read-only. Does not take the write lock. */
export async function listBranches(gitdir: string): Promise<string[]> {
  return gitListBranches({ fs, gitdir });
}

/**
 * Resolves `ref` (a branch name or an already-full commit oid) to its commit
 * oid. Used for MR base/head commits and SSR cache keys. Read-only. Returns
 * `null` if the ref doesn't exist.
 */
export async function getRefOid(gitdir: string, ref: string): Promise<string | null> {
  try {
    return await resolveRef({ fs, gitdir, ref });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export function userBranchName(username: string): string {
  return `user/${username}`;
}

/**
 * Creates (or returns, if it already exists) the single long-lived branch for
 * a user, per PRD §3: one branch per user, not per page/bundle.
 */
export async function createUserBranch(gitdir: string, username: string): Promise<string> {
  const ref = userBranchName(username);
  const branches = await gitListBranches({ fs, gitdir });
  if (!branches.includes(ref)) {
    await branch({ fs, gitdir, ref, object: DEFAULT_BRANCH, checkout: false });
  }
  return ref;
}

/**
 * Ensures `branchName` exists and shares history with `fromRef` (default:
 * main). Creates the branch off `fromRef` when missing; if it already exists
 * but has no merge-base with `fromRef` (orphan tip from a buggy first write),
 * force-resets the tip to `fromRef` so the next commit can squash-merge.
 *
 * Write operation — callers must run it through the repo write lock.
 */
export async function ensureBranchOff(
  gitdir: string,
  branchName: string,
  fromRef: string = DEFAULT_BRANCH,
): Promise<void> {
  const fromOid = await resolveRef({ fs, gitdir, ref: fromRef });
  const branches = await gitListBranches({ fs, gitdir });

  if (!branches.includes(branchName)) {
    await branch({ fs, gitdir, ref: branchName, object: fromRef, checkout: false });
    return;
  }

  const branchOid = await resolveRef({ fs, gitdir, ref: branchName });
  const [baseOid] = await findMergeBase({ fs, gitdir, oids: [branchOid, fromOid] });
  if (baseOid) return;

  await writeRef({
    fs,
    gitdir,
    ref: branchName.startsWith("refs/") ? branchName : `refs/heads/${branchName}`,
    value: fromOid,
    force: true,
  });
}
