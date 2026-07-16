import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { init, listBranches, writeCommit, writeRef, writeTree } from "isomorphic-git";

import type { CommitAuthor } from "./types";

export const DEFAULT_BRANCH = "main";

export const SYSTEM_AUTHOR: CommitAuthor = {
  name: "Kherad Wiki",
  email: "wiki@kherad.local",
};

export function toGitSignature(author: CommitAuthor) {
  return {
    name: author.name,
    email: author.email,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: new Date().getTimezoneOffset(),
  };
}

/**
 * Initializes the bare repo at `gitdir` if it doesn't already exist, and
 * ensures the default branch has at least one (possibly empty) commit so
 * `listBranches`/`branch` have a valid start point. Idempotent.
 */
export async function initRepo(gitdir: string): Promise<void> {
  await mkdir(gitdir, { recursive: true });

  const alreadyInitialized = fs.existsSync(path.join(gitdir, "HEAD"));
  if (!alreadyInitialized) {
    await init({ fs, gitdir, bare: true, defaultBranch: DEFAULT_BRANCH });
  }

  const branches = await listBranches({ fs, gitdir });
  if (!branches.includes(DEFAULT_BRANCH)) {
    const emptyTreeOid = await writeTree({ fs, gitdir, tree: [] });
    const signature = toGitSignature(SYSTEM_AUTHOR);
    const commitOid = await writeCommit({
      fs,
      gitdir,
      commit: {
        message: "Initial commit",
        tree: emptyTreeOid,
        parent: [],
        author: signature,
        committer: signature,
      },
    });
    await writeRef({
      fs,
      gitdir,
      ref: `refs/heads/${DEFAULT_BRANCH}`,
      value: commitOid,
      force: true,
    });
  }
}
