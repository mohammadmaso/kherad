import fs from "node:fs";

import http from "isomorphic-git/http/node";
import {
  fetch as gitFetch,
  readCommit,
  readTree,
  resolveRef,
  setConfig,
  writeCommit,
  writeRef,
} from "isomorphic-git";

import { isNotFoundError } from "./content";
import { toGitSignature } from "./repo";
import { graftSubtree, resolveSubtreeOid } from "./subtree";
import type { CommitAuthor, RemoteFetchTarget } from "./types";

export class RemotePullError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RemotePullError";
  }
}

/**
 * Transient remote name registered around each fetch: isomorphic-git's
 * `fetch` refuses to run without a configured refspec for the remote, even
 * when given an explicit `url`. Serialized by the repo write lock, so one
 * shared name is safe; its tracking refs land under `refs/kherad/remote/`
 * and are only ever read via the returned `fetchHead` oid.
 */
const FETCH_REMOTE_NAME = "kherad-sync";

/**
 * Fetches `target.branch` from `target.url` into the local object store and
 * returns the remote branch's commit oid. Callers decide what to do with the
 * fetched commit (see `applyRemoteSubtree`). `token` is optional so public
 * repos can be pulled anonymously. This writes config + tracking refs —
 * callers must run it through the repo's write lock.
 */
export async function fetchRemoteHead(gitdir: string, target: RemoteFetchTarget): Promise<string> {
  await setConfig({ fs, gitdir, path: `remote.${FETCH_REMOTE_NAME}.url`, value: target.url });
  await setConfig({
    fs,
    gitdir,
    path: `remote.${FETCH_REMOTE_NAME}.fetch`,
    value: "+refs/heads/*:refs/kherad/remote/*",
  });

  let result;
  try {
    result = await gitFetch({
      fs,
      http,
      gitdir,
      remote: FETCH_REMOTE_NAME,
      url: target.url,
      ref: target.branch,
      singleBranch: true,
      tags: false,
      ...(target.token ? { onAuth: () => ({ username: target.token!, password: "" }) } : {}),
    });
  } catch (err) {
    throw new RemotePullError(err instanceof Error ? err.message : "Fetch from remote failed", {
      cause: err,
    });
  } finally {
    await setConfig({ fs, gitdir, path: `remote.${FETCH_REMOTE_NAME}.url`, value: undefined });
    await setConfig({ fs, gitdir, path: `remote.${FETCH_REMOTE_NAME}.fetch`, value: undefined });
  }

  if (!result.fetchHead) {
    throw new RemotePullError(`Branch "${target.branch}" not found on remote`);
  }
  return result.fetchHead;
}

export type ApplyRemoteSubtreeResult = {
  /** False when the branch's subtree already matched the remote tree exactly. */
  changed: boolean;
  beforeOid: string;
  afterOid: string;
};

/**
 * Replaces `pathPrefix` (e.g. `raw/<slug>`) on `targetBranch` with the root
 * tree of `remoteCommitOid` (already fetched into this gitdir), as a single
 * commit — the local subtree becomes an exact copy of the remote repo's root.
 * An empty remote tree removes the subtree entirely: pull mirrors the remote,
 * it does not merge with local edits. `removePrefixes` (e.g. the legacy
 * `wiki/<slug>` location) are deleted in the same commit so stale copies
 * can't shadow the pulled content through legacy read fallbacks.
 *
 * This is a write operation — callers must run it through the repo's write lock.
 */
export async function applyRemoteSubtree(
  gitdir: string,
  targetBranch: string,
  pathPrefix: string,
  remoteCommitOid: string,
  message: string,
  author: CommitAuthor,
  removePrefixes: string[] = [],
): Promise<ApplyRemoteSubtreeResult> {
  let beforeOid: string;
  try {
    beforeOid = await resolveRef({ fs, gitdir, ref: targetBranch });
  } catch (err) {
    if (isNotFoundError(err)) throw new RemotePullError(`Branch "${targetBranch}" does not exist`);
    throw err;
  }

  const baseRootOid = (await readCommit({ fs, gitdir, oid: beforeOid })).commit.tree;
  const remoteRootOid = (await readCommit({ fs, gitdir, oid: remoteCommitOid })).commit.tree;
  const remoteIsEmpty = (await readTree({ fs, gitdir, oid: remoteRootOid })).tree.length === 0;
  const newSubtreeOid = remoteIsEmpty ? null : remoteRootOid;

  const currentSubtreeOid = await resolveSubtreeOid(gitdir, baseRootOid, pathPrefix);
  const staleRemovals: string[] = [];
  for (const prefix of removePrefixes) {
    if ((await resolveSubtreeOid(gitdir, baseRootOid, prefix)) !== null) {
      staleRemovals.push(prefix);
    }
  }

  if (currentSubtreeOid === newSubtreeOid && staleRemovals.length === 0) {
    return { changed: false, beforeOid, afterOid: beforeOid };
  }

  let newRootOid = await graftSubtree(
    gitdir,
    baseRootOid,
    pathPrefix.split("/").filter(Boolean),
    newSubtreeOid,
  );
  for (const prefix of staleRemovals) {
    newRootOid = await graftSubtree(gitdir, newRootOid, prefix.split("/").filter(Boolean), null);
  }

  const signature = toGitSignature(author);
  const afterOid = await writeCommit({
    fs,
    gitdir,
    commit: {
      message,
      tree: newRootOid,
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

  return { changed: true, beforeOid, afterOid };
}
