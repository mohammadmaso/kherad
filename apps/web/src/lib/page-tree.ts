export type WikiNavPage = { id: string; path: string; title: string };

/**
 * One entry in the sidebar tree. A node is either a folder (`children`) or a
 * document (`page`) — never both in the UI. Intermediate path segments are
 * folders; only leaf paths are documents. A page row that shares a folder's
 * path may still be attached for metadata, but callers must treat
 * `children.length > 0` as folder-only.
 */
export type WikiNavNode = {
  name: string;
  path: string;
  page: WikiNavPage | null;
  children: WikiNavNode[];
};

export function isFolderNode(node: WikiNavNode): boolean {
  return node.children.length > 0;
}

export function labelFor(node: WikiNavNode): string {
  // Folders are path segments, not documents — never use a page title here.
  if (isFolderNode(node) || !node.page) return prettifySegment(node.name);
  return node.page.title;
}

export function prettifySegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

export function sortTree(nodes: WikiNavNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = isFolderNode(a);
    const bFolder = isFolderNode(b);
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return labelFor(a).localeCompare(labelFor(b), undefined, { sensitivity: "base" });
  });
  for (const node of nodes) sortTree(node.children);
}

/**
 * Folder prefixes that already exist in the tree (ancestor segments only —
 * never a document's own path). Used when placing a new page under a folder.
 */
export function existingFolderPaths(pages: { path: string }[]): string[] {
  const folders = new Set<string>();
  for (const page of pages) {
    const segments = page.path.split("/");
    // Skip the final segment — that's the document, not a folder.
    for (let i = 1; i < segments.length; i++) {
      folders.add(segments.slice(0, i).join("/"));
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Immediate child folder names under `parent` ("" = bundle root).
 * Only one path segment each — for per-directory pickers.
 */
export function childFolderNames(folders: string[], parent: string): string[] {
  const prefix = parent ? `${parent}/` : "";
  const names = new Set<string>();
  for (const folder of folders) {
    if (parent) {
      if (folder === parent || !folder.startsWith(prefix)) continue;
      const name = folder.slice(prefix.length).split("/")[0];
      if (name) names.add(name);
    } else {
      const name = folder.split("/")[0];
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Builds a folder/file tree from a flat list of pages, sorted folders-first then alphabetically. */
export function buildTree(pages: WikiNavPage[]): WikiNavNode[] {
  const roots: WikiNavNode[] = [];
  const byPath = new Map<string, WikiNavNode>();

  const nodeAt = (path: string, name: string): WikiNavNode => {
    let node = byPath.get(path);
    if (!node) {
      node = { name, path, page: null, children: [] };
      byPath.set(path, node);
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
      if (parentPath) {
        nodeAt(parentPath, parentPath.slice(parentPath.lastIndexOf("/") + 1)).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return node;
  };

  for (const page of pages) {
    const segments = page.path.split("/");
    nodeAt(page.path, segments[segments.length - 1] ?? page.path).page = page;
  }

  sortTree(roots);
  return roots;
}
