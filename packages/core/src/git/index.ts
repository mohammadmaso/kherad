export { isNotFoundError } from "./content";
export { createGitEngine, type GitEngine } from "./engine";
export {
  BINARY_CONFLICT_OURS,
  BINARY_CONFLICT_THEIRS,
  isBinaryConflictToken,
} from "../binary-conflict";
export { MergeConflictDetectedError } from "./merge";
export {
  bundleGitPathPrefix,
  isImageAssetPath,
  legacyBundleGitPathPrefix,
  legacyPageGitPath,
  normalizePagePath,
  pagePathFromTitle,
  resolvePagePath,
  DOCUMENTS_GIT_PATH_PREFIX,
  okfDocGitPath,
  okfDocSitePath,
  okfGitPathPrefix,
  pageGitPath,
} from "./paths";
export { decryptRemoteToken, encryptRemoteToken } from "./remote-secret";
export { RemotePushError } from "./remote-push";
export { RemotePullError } from "./remote-pull";
export { DEFAULT_BRANCH } from "./repo";
export { userBranchName } from "./refs";
export {
  isValidVersionName,
  versionBranchName,
  WikiVersionError,
  type RestoreVersionResult,
  type WikiCommit,
  type WikiVersion,
} from "./versions";
export { getLatestSourcePageAtRef, getSourcePageAtRef } from "./source";
export type {
  CommitAuthor,
  ConflictFile,
  DiffEntry,
  DiffStatus,
  FileWrite,
  MergeResult,
  RemoteFetchTarget,
  RemotePushTarget,
  SubtreePullResult,
  SubtreePushResult,
} from "./types";

import path from "node:path";

import { createGitEngine, type GitEngine } from "./engine";

let cached: GitEngine | undefined;

/**
 * The process-wide git engine bound to `GIT_REPO_PATH`. Lazily constructed so
 * importing this module doesn't require the env var to be set (tests build
 * their own engine against a temp dir via `createGitEngine` instead).
 * Relative paths are resolved against `process.cwd()` so both the API and
 * Next.js land on the same absolute directory when given matching env values.
 */
export function defaultGitEngine(): GitEngine {
  if (!cached) {
    const gitdir = process.env.GIT_REPO_PATH;
    if (!gitdir) {
      throw new Error("GIT_REPO_PATH is not set");
    }
    cached = createGitEngine(path.resolve(gitdir));
  }
  return cached;
}
