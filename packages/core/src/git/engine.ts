import { getFileAtRef, getLastCommitTimestamp, listFilesAtRef, writeAndCommit } from "./content";
import { diffRefs } from "./diff";
import { createWriteLock } from "./lock";
import { resolveSquashMergeConflict, squashMerge } from "./merge";
import { applyRemoteSubtree, fetchRemoteHead } from "./remote-pull";
import { pushMirrorRef } from "./remote-push";
import { createUserBranch, ensureBranchOff, getRefOid, listBranches } from "./refs";
import { initRepo, SYSTEM_AUTHOR } from "./repo";
import { getSourcePageAtRef, getLatestSourcePageAtRef } from "./source";
import { bundleGitPathPrefix, DOCUMENTS_GIT_PATH_PREFIX, legacyBundleGitPathPrefix } from "./paths";
import { buildSubtreeMirror, bundleMirrorRefName, documentMirrorRefName } from "./subtree";
import {
  createWikiVersion,
  deleteWikiVersion,
  listWikiCommits,
  listWikiVersions,
  restoreWikiVersion,
  type RestoreVersionResult,
  type WikiCommit,
  type WikiVersion,
} from "./versions";
import type {
  CommitAuthor,
  DiffEntry,
  FileWrite,
  MergeResult,
  RemoteFetchTarget,
  RemotePushTarget,
  SubtreePullResult,
  SubtreePushResult,
} from "./types";

export type GitEngine = {
  gitdir: string;
  /** Idempotent. Not lock-guarded (runs before the repo directory necessarily exists). */
  initRepo(): Promise<void>;
  /** Read-only. */
  getFileAtRef(ref: string, path: string): Promise<Uint8Array | null>;
  /** Read-only. Source page under `raw/…`, with legacy `wiki/…` fallback. */
  getSourcePageAtRef(ref: string, bundleSlug: string, pagePath: string): Promise<Uint8Array | null>;
  /**
   * Read-only. Newest source-page content across `defaultBranch` and every
   * `user/*` branch — used when compiling before human source MRs land on main.
   */
  getLatestSourcePageAtRef(
    defaultBranch: string,
    bundleSlug: string,
    pagePath: string,
  ): Promise<Uint8Array | null>;
  /** Read-only. */
  getLastCommitTimestamp(ref: string): Promise<Date | null>;
  /** Read-only. Resolves a branch name (or a already-full oid) to its commit oid. */
  getRefOid(ref: string): Promise<string | null>;
  /** Read-only. */
  listBranches(): Promise<string[]>;
  /** Read-only. Lists blob paths at `ref`, optionally scoped to a directory prefix. `[]` if the ref is missing. */
  listFilesAtRef(ref: string, pathPrefix?: string): Promise<string[]>;
  /** Write. Serialized via the repo write lock. */
  createUserBranch(username: string): Promise<string>;
  /**
   * Write. Serialized via the repo write lock. Creates `branch` off `fromRef`
   * when missing, or resets an orphan tip that shares no history with `fromRef`.
   */
  ensureBranchOff(branch: string, fromRef?: string): Promise<void>;
  /** Write. Serialized via the repo write lock. */
  writeAndCommit(
    branch: string,
    files: FileWrite[],
    message: string,
    author: CommitAuthor,
  ): Promise<string>;
  /** Read-only. */
  diffRefs(baseRef: string, headRef: string, path?: string): Promise<DiffEntry[]>;
  /**
   * Write. Serialized via the repo write lock. Throws
   * `MergeConflictDetectedError` (carrying per-path conflict-marker text) when
   * both branches touch the same lines of the same file(s). `pathPrefix`
   * scopes both conflict detection and the written tree to that subtree
   * (e.g. one bundle's `wiki/<slug>`) — required for any repo where branches
   * can span more than one bundle, since a user has one branch total, not
   * one per bundle. Omit only for a single-purpose repo (e.g. tests).
   */
  squashMerge(
    sourceBranch: string,
    targetBranch: string,
    message: string,
    pathPrefix?: string,
  ): Promise<MergeResult>;
  /**
   * Write. Serialized via the repo write lock. Completes a merge a manager
   * resolved by hand. `pathPrefix` must match whatever `squashMerge` used to
   * produce the conflict being resolved.
   */
  resolveMergeConflict(
    sourceBranch: string,
    targetBranch: string,
    message: string,
    resolutions: { path: string; content: string }[],
    pathPrefix?: string,
  ): Promise<MergeResult>;
  /**
   * Write (rewrites the document mirror ref) + network push. Serialized via
   * the repo write lock. Rebuilds a linear, subtree-only commit history for
   * all compiled OKF documents under `okf/` off `sourceRef` (see
   * `buildSubtreeMirror`) and force-pushes it to `remote`. The remote repo
   * receives bundle folders at its root (`<slug>/…`), not `okf/`, `raw/`, or
   * `wiki/`. Resolves `pushed: false` if no OKF documents are committed yet.
   */
  pushDocumentsMirror(sourceRef: string, remote: RemotePushTarget): Promise<SubtreePushResult>;
  /**
   * Write (rewrites the bundle mirror ref) + network push. Serialized via the
   * repo write lock. Rebuilds a linear, subtree-only history of one bundle's
   * source pages (`raw/<slug>`, falling back to legacy `wiki/<slug>` when
   * nothing lives under `raw/` yet) off `sourceRef` and force-pushes it to
   * `remote` — the remote repo receives the bundle's pages at its root.
   * Resolves `pushed: false` if the bundle has no committed pages.
   */
  pushBundleMirror(
    sourceRef: string,
    bundleSlug: string,
    remote: RemotePushTarget,
  ): Promise<SubtreePushResult>;
  /**
   * Network fetch + write. Serialized via the repo write lock. Fetches
   * `remote.branch` and replaces `raw/<slug>` on `targetBranch` with the
   * remote repo's root tree in a single commit (an exact mirror — local-only
   * pages under the prefix are deleted; any legacy `wiki/<slug>` copy is
   * removed in the same commit). Callers must reconcile Postgres `pages`
   * rows afterwards.
   */
  pullBundleSubtree(
    targetBranch: string,
    bundleSlug: string,
    remote: RemoteFetchTarget,
  ): Promise<SubtreePullResult>;
  /**
   * Network fetch + write. Serialized via the repo write lock. Inverse of
   * `pushDocumentsMirror`: fetches `remote.branch` and replaces the whole
   * `okf/` subtree on `targetBranch` with the remote repo's root tree
   * (`<slug>/…` folders become `okf/<slug>/…`) in a single commit. Callers
   * must reconcile Postgres OKF page rows afterwards.
   */
  pullDocumentsFromRemote(
    targetBranch: string,
    remote: RemoteFetchTarget,
  ): Promise<SubtreePullResult>;
  /**
   * Write. Serialized via the repo write lock. Snapshots `fromRef` (default:
   * `main`; also accepts a full commit oid from `listWikiCommits`) as
   * `version/<name>`.
   */
  createWikiVersion(name: string, author: CommitAuthor, fromRef?: string): Promise<WikiVersion>;
  /** Read-only. Every `version/*` snapshot, newest first. */
  listWikiVersions(): Promise<WikiVersion[]>;
  /** Read-only. Commit history of `ref` (default: main), newest first. */
  listWikiCommits(ref?: string, depth?: number): Promise<WikiCommit[]>;
  /**
   * Write. Serialized via the repo write lock. Restores `main` to the
   * version's tree as one new commit (linear history; the pre-restore state
   * stays reachable). Callers must reconcile Postgres page rows afterwards.
   */
  restoreWikiVersion(name: string, author: CommitAuthor): Promise<RestoreVersionResult>;
  /** Write. Serialized via the repo write lock. Deletes the version branch. */
  deleteWikiVersion(name: string): Promise<void>;
};

export function createGitEngine(gitdir: string): GitEngine {
  const withWriteLock = createWriteLock(gitdir);

  return {
    gitdir,

    initRepo: () => initRepo(gitdir),

    getFileAtRef: (ref, path) => getFileAtRef(gitdir, ref, path),

    /** Prefer `raw/…`, fall back to legacy `wiki/…` for source pages. */
    getSourcePageAtRef: (ref, bundleSlug, pagePath) =>
      getSourcePageAtRef(gitdir, ref, bundleSlug, pagePath),

    getLatestSourcePageAtRef: async (defaultBranch, bundleSlug, pagePath) => {
      const branches = await listBranches(gitdir);
      return getLatestSourcePageAtRef(gitdir, defaultBranch, bundleSlug, pagePath, branches);
    },

    getLastCommitTimestamp: (ref) => getLastCommitTimestamp(gitdir, ref),

    getRefOid: (ref) => getRefOid(gitdir, ref),

    listBranches: () => listBranches(gitdir),

    listFilesAtRef: (ref, pathPrefix) => listFilesAtRef(gitdir, ref, pathPrefix),

    createUserBranch: (username) => withWriteLock(() => createUserBranch(gitdir, username)),

    ensureBranchOff: (branch, fromRef) =>
      withWriteLock(() => ensureBranchOff(gitdir, branch, fromRef)),

    writeAndCommit: (branch, files, message, author) =>
      withWriteLock(() => writeAndCommit(gitdir, branch, files, message, author)),

    diffRefs: (baseRef, headRef, path) => diffRefs(gitdir, baseRef, headRef, path),

    squashMerge: (sourceBranch, targetBranch, message, pathPrefix) =>
      withWriteLock(() => squashMerge(gitdir, sourceBranch, targetBranch, message, pathPrefix)),

    resolveMergeConflict: (sourceBranch, targetBranch, message, resolutions, pathPrefix) =>
      withWriteLock(() =>
        resolveSquashMergeConflict(
          gitdir,
          sourceBranch,
          targetBranch,
          message,
          resolutions,
          pathPrefix,
        ),
      ),

    pushDocumentsMirror: (sourceRef, remote) =>
      withWriteLock(async () => {
        const mirrorRef = documentMirrorRefName();
        const { tipOid, commitCount } = await buildSubtreeMirror(
          gitdir,
          sourceRef,
          DOCUMENTS_GIT_PATH_PREFIX,
          mirrorRef,
        );
        if (!tipOid) return { pushed: false, commitCount: 0, oid: null };

        await pushMirrorRef(gitdir, mirrorRef, remote);
        return { pushed: true, commitCount, oid: tipOid };
      }),

    pushBundleMirror: (sourceRef, bundleSlug, remote) =>
      withWriteLock(async () => {
        const mirrorRef = bundleMirrorRefName(bundleSlug);
        let mirror = await buildSubtreeMirror(
          gitdir,
          sourceRef,
          bundleGitPathPrefix(bundleSlug),
          mirrorRef,
        );
        if (!mirror.tipOid) {
          // Bundle not yet migrated to raw/ — mirror the legacy location instead.
          mirror = await buildSubtreeMirror(
            gitdir,
            sourceRef,
            legacyBundleGitPathPrefix(bundleSlug),
            mirrorRef,
          );
        }
        if (!mirror.tipOid) return { pushed: false, commitCount: 0, oid: null };

        await pushMirrorRef(gitdir, mirrorRef, remote);
        return { pushed: true, commitCount: mirror.commitCount, oid: mirror.tipOid };
      }),

    pullBundleSubtree: (targetBranch, bundleSlug, remote) =>
      withWriteLock(async () => {
        const remoteOid = await fetchRemoteHead(gitdir, remote);
        const result = await applyRemoteSubtree(
          gitdir,
          targetBranch,
          bundleGitPathPrefix(bundleSlug),
          remoteOid,
          `Pull bundle "${bundleSlug}" from remote (${remoteOid.slice(0, 7)})`,
          SYSTEM_AUTHOR,
          [legacyBundleGitPathPrefix(bundleSlug)],
        );
        return { ...result, remoteOid };
      }),

    pullDocumentsFromRemote: (targetBranch, remote) =>
      withWriteLock(async () => {
        const remoteOid = await fetchRemoteHead(gitdir, remote);
        const result = await applyRemoteSubtree(
          gitdir,
          targetBranch,
          DOCUMENTS_GIT_PATH_PREFIX,
          remoteOid,
          `Pull documents from remote (${remoteOid.slice(0, 7)})`,
          SYSTEM_AUTHOR,
        );
        return { ...result, remoteOid };
      }),

    createWikiVersion: (name, author, fromRef) =>
      withWriteLock(() => createWikiVersion(gitdir, name, author, fromRef)),

    listWikiVersions: async () => listWikiVersions(gitdir, await listBranches(gitdir)),

    listWikiCommits: (ref, depth) => listWikiCommits(gitdir, ref, depth),

    restoreWikiVersion: (name, author) =>
      withWriteLock(() => restoreWikiVersion(gitdir, name, author)),

    deleteWikiVersion: (name) => withWriteLock(() => deleteWikiVersion(gitdir, name)),
  };
}
