export type CommitAuthor = {
  name: string;
  email: string;
};

/** A single file write within a commit. `content: null` deletes the path. */
export type FileWrite = {
  path: string;
  content: string | Uint8Array | null;
};

export type DiffStatus = "added" | "modified" | "deleted";

export type DiffEntry = {
  path: string;
  status: DiffStatus;
};

export type MergeResult = {
  oid: string;
  /** True if the source branch had no new changes to bring in. */
  alreadyMerged: boolean;
};

/** A single file left with raw `<<<<<<<`/`=======`/`>>>>>>>` conflict markers. */
export type ConflictFile = {
  path: string;
  markerText: string;
};

export type RemotePushTarget = {
  /** HTTPS URL only — e.g. `https://github.com/org/repo.git`. */
  url: string;
  /** Branch name on the remote to force-push onto, e.g. `main`. */
  branch: string;
  /** Personal access token, sent as the HTTP Basic username per GitHub/GitLab convention. */
  token: string;
};

export type SubtreePushResult = {
  /** `false` if `pathPrefix` has no committed content yet — nothing was pushed. */
  pushed: boolean;
  commitCount: number;
  oid: string | null;
};

/** Like `RemotePushTarget`, but `token` is optional so public repos can be fetched anonymously. */
export type RemoteFetchTarget = {
  url: string;
  branch: string;
  token: string | null;
};

export type SubtreePullResult = {
  /** `false` if the local subtree already matched the remote — no commit was made. */
  changed: boolean;
  /** Branch tip before/after the pull commit (equal when `changed` is false). */
  beforeOid: string;
  afterOid: string;
  /** The remote branch commit that was fetched. */
  remoteOid: string;
};
