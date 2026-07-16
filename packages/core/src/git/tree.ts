import fs from "node:fs";

import { readTree, writeBlob, writeTree, type TreeEntry } from "isomorphic-git";

function toUint8Array(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

function groupByTopLevel(changes: Map<string, string | Uint8Array | null>): {
  direct: Map<string, string | Uint8Array | null>;
  nested: Map<string, Map<string, string | Uint8Array | null>>;
} {
  const direct = new Map<string, string | Uint8Array | null>();
  const nested = new Map<string, Map<string, string | Uint8Array | null>>();

  for (const [fullPath, content] of changes) {
    const slash = fullPath.indexOf("/");
    if (slash === -1) {
      direct.set(fullPath, content);
      continue;
    }
    const dirName = fullPath.slice(0, slash);
    const rest = fullPath.slice(slash + 1);
    if (!nested.has(dirName)) nested.set(dirName, new Map());
    nested.get(dirName)!.set(rest, content);
  }

  return { direct, nested };
}

/**
 * Applies a flat map of `path -> content` (content `null` deletes the path)
 * on top of an existing tree, recursing into subdirectories as needed, and
 * returns the oid of the resulting tree. Directories left empty after
 * deletions are pruned.
 */
export async function applyTreeChanges(
  gitdir: string,
  baseTreeOid: string | undefined,
  changes: Map<string, string | Uint8Array | null>,
): Promise<string> {
  let existing: TreeEntry[] = [];
  if (baseTreeOid) {
    existing = (await readTree({ fs, gitdir, oid: baseTreeOid })).tree;
  }

  const byName = new Map(existing.map((entry) => [entry.path, entry]));
  const { direct, nested } = groupByTopLevel(changes);

  for (const [name, content] of direct) {
    if (content === null) {
      byName.delete(name);
      continue;
    }
    const oid = await writeBlob({ fs, gitdir, blob: toUint8Array(content) });
    byName.set(name, { mode: "100644", path: name, oid, type: "blob" });
  }

  for (const [name, subChanges] of nested) {
    const existingEntry = byName.get(name);
    const subBaseOid = existingEntry?.type === "tree" ? existingEntry.oid : undefined;
    const subOid = await applyTreeChanges(gitdir, subBaseOid, subChanges);
    const subTree = (await readTree({ fs, gitdir, oid: subOid })).tree;
    if (subTree.length === 0) {
      byName.delete(name);
    } else {
      byName.set(name, { mode: "040000", path: name, oid: subOid, type: "tree" });
    }
  }

  return writeTree({ fs, gitdir, tree: Array.from(byName.values()) });
}
