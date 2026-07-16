import fs from "node:fs";

import http from "isomorphic-git/http/node";
import { push } from "isomorphic-git";

import type { RemotePushTarget } from "./types";

export class RemotePushError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RemotePushError";
  }
}

/**
 * Force-pushes `localRef` (expected to be a `documentMirrorRefName` ref built
 * by `buildSubtreeMirror`) to `target.branch` on `target.url`. Force is
 * intentional: the mirror history is fully regenerated from the OKF document
 * tree on every push, so the remote branch is meant to always match it
 * exactly, not accumulate independent commits.
 */
export async function pushMirrorRef(
  gitdir: string,
  localRef: string,
  target: RemotePushTarget,
): Promise<{ ok: true }> {
  const remoteBranchRef = `refs/heads/${target.branch}`;
  let result;
  try {
    result = await push({
      fs,
      http,
      gitdir,
      ref: localRef,
      remoteRef: remoteBranchRef,
      url: target.url,
      force: true,
      onAuth: () => ({ username: target.token, password: "" }),
    });
  } catch (err) {
    throw new RemotePushError(err instanceof Error ? err.message : "Push to remote failed", {
      cause: err,
    });
  }

  if (!result.ok || result.error) {
    throw new RemotePushError(result.error ?? "Push rejected by remote");
  }
  const refStatus = result.refs[remoteBranchRef];
  if (refStatus && !refStatus.ok) {
    throw new RemotePushError(refStatus.error || "Push rejected by remote");
  }

  return { ok: true };
}
