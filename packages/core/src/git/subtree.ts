import fs from "node:fs";

import {
  readTree,
  resolveRef,
  writeCommit,
  writeRef,
  writeTree,
  log as gitLog,
  type TreeEntry,
} from "isomorphic-git";

import { isNotFoundError } from "./content";

/**
 * Local ref namespace (never a real branch) that holds the rewritten,
 * subtree-only commit history built by `buildSubtreeMirror` for all
 * compiled OKF documents — the tip pushed to the global document remote.
 */
export function documentMirrorRefName(): string {
  return "refs/kherad/mirror/documents";
}

/**
 * Local ref namespace holding the rewritten, subtree-only history for one
 * bundle's source pages — the tip pushed to that bundle's own remote.
 */
export function bundleMirrorRefName(bundleSlug: string): string {
  return `refs/kherad/mirror/bundles/${bundleSlug}`;
}

/** Walks `pathPrefix` (e.g. `wiki/engineering`) down from a tree oid, returning the subtree's oid or `null` if it doesn't exist at that commit. */
export async function resolveSubtreeOid(
  gitdir: string,
  rootTreeOid: string,
  pathPrefix: string,
): Promise<string | null> {
  let currentOid = rootTreeOid;
  for (const segment of pathPrefix.split("/").filter(Boolean)) {
    let tree;
    try {
      ({ tree } = await readTree({ fs, gitdir, oid: currentOid }));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
    const entry = tree.find((e) => e.path === segment && e.type === "tree");
    if (!entry) return null;
    currentOid = entry.oid;
  }
  return currentOid;
}

/**
 * Rewrites `pathSegments` within `baseTreeOid` to point at `subtreeOid`
 * (`null` removes the entry), creating intermediate directories as needed,
 * and returns the new root tree oid. Sibling entries — including everything
 * outside `pathSegments`, such as other bundles' content — are untouched.
 */
export async function graftSubtree(
  gitdir: string,
  baseTreeOid: string | undefined,
  pathSegments: string[],
  subtreeOid: string | null,
): Promise<string> {
  const [head, ...rest] = pathSegments;
  if (!head) throw new Error("graftSubtree requires a non-empty path");

  let entries: TreeEntry[] = [];
  if (baseTreeOid) {
    entries = (await readTree({ fs, gitdir, oid: baseTreeOid })).tree;
  }
  const byName = new Map(entries.map((entry) => [entry.path, entry]));

  if (rest.length === 0) {
    if (subtreeOid === null) {
      byName.delete(head);
    } else {
      byName.set(head, { mode: "040000", path: head, oid: subtreeOid, type: "tree" });
    }
  } else {
    const existing = byName.get(head);
    const childBase = existing?.type === "tree" ? existing.oid : undefined;
    const childOid = await graftSubtree(gitdir, childBase, rest, subtreeOid);
    const childEntries = (await readTree({ fs, gitdir, oid: childOid })).tree;
    if (childEntries.length === 0) {
      byName.delete(head);
    } else {
      byName.set(head, { mode: "040000", path: head, oid: childOid, type: "tree" });
    }
  }

  return writeTree({ fs, gitdir, tree: Array.from(byName.values()) });
}

/**
 * Rebuilds `mirrorRef` as a linear, single-bundle commit history: for every
 * commit reachable from `sourceRef` (oldest to newest) whose tree contains a
 * change under `pathPrefix`, writes a new commit whose tree is *just* that
 * subtree (re-rooted, so the remote repo looks like a standalone repo rather
 * than one directory among many), re-parented onto the previous rewritten
 * commit. Consecutive commits with an unchanged subtree are skipped, matching
 * `git subtree split --prefix=<pathPrefix>` semantics. Author/committer/message
 * are preserved from the original commit.
 *
 * Rebuilds from scratch on every call rather than resuming from the last
 * push — simpler and correct (git objects are content-addressed, so
 * re-writing unchanged objects is a no-op), at the cost of walking the full
 * source history each time. Acceptable for a manual, admin-triggered push;
 * would need incremental bookkeeping to scale to very long histories.
 *
 * Returns `tipOid: null` if `pathPrefix` never existed on `sourceRef` (bundle
 * has no committed pages yet). This is a write operation — callers must run
 * it through the repo's write lock.
 */
export async function buildSubtreeMirror(
  gitdir: string,
  sourceRef: string,
  pathPrefix: string,
  mirrorRef: string,
): Promise<{ tipOid: string | null; commitCount: number }> {
  let sourceOid: string;
  try {
    sourceOid = await resolveRef({ fs, gitdir, ref: sourceRef });
  } catch (err) {
    if (isNotFoundError(err)) return { tipOid: null, commitCount: 0 };
    throw err;
  }

  const commits = await gitLog({ fs, gitdir, ref: sourceOid });
  commits.reverse(); // oldest first

  let previousSubtreeOid: string | null = null;
  let previousMirrorOid: string | undefined;
  let commitCount = 0;

  for (const { commit } of commits) {
    const subtreeOid = await resolveSubtreeOid(gitdir, commit.tree, pathPrefix);
    if (subtreeOid === null || subtreeOid === previousSubtreeOid) continue;

    previousSubtreeOid = subtreeOid;
    previousMirrorOid = await writeCommit({
      fs,
      gitdir,
      commit: {
        message: commit.message,
        tree: subtreeOid,
        parent: previousMirrorOid ? [previousMirrorOid] : [],
        author: commit.author,
        committer: commit.committer,
      },
    });
    commitCount += 1;
  }

  if (!previousMirrorOid) return { tipOid: null, commitCount: 0 };

  await writeRef({ fs, gitdir, ref: mirrorRef, value: previousMirrorOid, force: true });
  return { tipOid: previousMirrorOid, commitCount };
}
