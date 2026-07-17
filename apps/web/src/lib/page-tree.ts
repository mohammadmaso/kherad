export type WikiNavPage = { id: string; path: string; title: string };

/**
 * One entry in the sidebar tree. A node is a folder (has `children`), a page
 * (has `page`), or both at once — e.g. `guides` is a page *and* the parent of
 * `guides/setup`.
 */
export type WikiNavNode = {
  name: string;
  path: string;
  page: WikiNavPage | null;
  children: WikiNavNode[];
};

export function labelFor(node: WikiNavNode): string {
  if (node.page) return node.page.title;
  return prettifySegment(node.name);
}

export function prettifySegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

export function sortTree(nodes: WikiNavNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.children.length > 0;
    const bFolder = b.children.length > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return labelFor(a).localeCompare(labelFor(b), undefined, { sensitivity: "base" });
  });
  for (const node of nodes) sortTree(node.children);
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
