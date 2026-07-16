import fs from "node:fs";

import { TREE, walk } from "isomorphic-git";

import type { DiffEntry } from "./types";

/** git's well-known empty-tree object id — valid in any repo without needing to exist on disk. */
export const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Like `diffRefs`, but resolves each changed leaf's content instead of just
 * its status — `beforeOid`/`afterOid` may be commit oids *or* raw tree oids
 * (isomorphic-git resolves either transparently), which lets callers diff
 * two bare subtree oids directly. Used to splice a merged subtree back into
 * a real commit's tree as a flat set of blob writes. Read-only.
 */
export async function treeContentChanges(
  gitdir: string,
  beforeOid: string,
  afterOid: string,
): Promise<Map<string, Uint8Array | null>> {
  const changes = new Map<string, Uint8Array | null>();

  await walk({
    fs,
    gitdir,
    trees: [TREE({ ref: beforeOid }), TREE({ ref: afterOid })],
    map: async (filepath, [before, after]) => {
      if (filepath === ".") return undefined;

      const beforeType = before ? await before.type() : undefined;
      const afterType = after ? await after.type() : undefined;
      if (beforeType === "tree" || afterType === "tree") return undefined;

      if (!before && after) {
        changes.set(filepath, (await after.content()) ?? null);
      } else if (before && !after) {
        changes.set(filepath, null);
      } else if (before && after) {
        const [beforeOidLeaf, afterOidLeaf] = await Promise.all([before.oid(), after.oid()]);
        if (beforeOidLeaf !== afterOidLeaf) changes.set(filepath, (await after.content()) ?? null);
      }
      return undefined;
    },
  });

  return changes;
}

/** Read-only. Does not take the write lock. */
export async function diffRefs(
  gitdir: string,
  baseRef: string,
  headRef: string,
  path?: string,
): Promise<DiffEntry[]> {
  const results = await walk({
    fs,
    gitdir,
    trees: [TREE({ ref: baseRef }), TREE({ ref: headRef })],
    map: async (filepath, [base, head]): Promise<DiffEntry | undefined> => {
      if (filepath === ".") return undefined;
      if (path && filepath !== path && !filepath.startsWith(`${path}/`)) return undefined;

      const baseType = base ? await base.type() : undefined;
      const headType = head ? await head.type() : undefined;
      if (baseType === "tree" || headType === "tree") return undefined;

      if (!base && head) return { path: filepath, status: "added" };
      if (base && !head) return { path: filepath, status: "deleted" };
      if (base && head) {
        const [baseOid, headOid] = await Promise.all([base.oid(), head.oid()]);
        if (baseOid !== headOid) return { path: filepath, status: "modified" };
      }
      return undefined;
    },
  });

  return (results as DiffEntry[]) ?? [];
}
