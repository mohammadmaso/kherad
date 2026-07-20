export type WikiNavPage = { id: string; path: string; title: string };

/**
 * One entry in the sidebar tree. A node is either a folder (`children` or an
 * empty-folder placeholder) or a document (`page`) — never both in the UI.
 */
export type WikiNavNode = {
  name: string;
  path: string;
  page: WikiNavPage | null;
  children: WikiNavNode[];
  /** Directory exists via `.gitkeep` (or similar) with no pages under it yet. */
  emptyFolder?: boolean;
};

export function isFolderNode(node: WikiNavNode): boolean {
  return node.children.length > 0 || Boolean(node.emptyFolder);
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
 * never a document's own path), plus any explicit empty-folder paths.
 */
export function existingFolderPaths(
  pages: { path: string }[],
  emptyFolders: string[] = [],
): string[] {
  const folders = new Set<string>(emptyFolders);
  for (const page of pages) {
    const segments = page.path.split("/");
    // Skip the final segment — that's the document, not a folder.
    for (let i = 1; i < segments.length; i++) {
      folders.add(segments.slice(0, i).join("/"));
    }
  }
  for (const folder of emptyFolders) {
    const segments = folder.split("/");
    for (let i = 1; i <= segments.length; i++) {
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

/** Builds a folder/file tree from pages plus optional empty directory paths. */
export function buildTree(pages: WikiNavPage[], emptyFolders: string[] = []): WikiNavNode[] {
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

  for (const folder of emptyFolders) {
    const segments = folder.split("/");
    const node = nodeAt(folder, segments[segments.length - 1] ?? folder);
    if (!node.page && node.children.length === 0) {
      node.emptyFolder = true;
    }
  }

  sortTree(roots);
  return roots;
}
