import { type AuthedUser } from "@kherad/core/auth";
import {
  bundleGitPathPrefix,
  defaultGitEngine,
  isValidVersionName,
  legacyBundleGitPathPrefix,
  okfDocSitePath,
  okfGitPathPrefix,
  versionBranchName,
} from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema } from "@kherad/db";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "./db";

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

export type WikiNav = {
  bundle: {
    id: string;
    slug: string;
    title: string;
    isPublic: boolean;
    mode: "raw" | "llm_compiled";
  };
  tree: WikiNavNode[];
  pageCount: number;
};

function labelFor(node: WikiNavNode): string {
  if (node.page) return node.page.title;
  return node.name.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

function sortTree(nodes: WikiNavNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.children.length > 0;
    const bFolder = b.children.length > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return labelFor(a).localeCompare(labelFor(b), undefined, { sensitivity: "base" });
  });
  for (const node of nodes) sortTree(node.children);
}

function buildTree(pages: WikiNavPage[]): WikiNavNode[] {
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

/** Pull a display title out of OKF YAML frontmatter when present. */
function titleFromOkfMarkdown(markdown: string, fallback: string): string {
  if (!markdown.startsWith("---")) return fallback;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return fallback;
  const fm = markdown.slice(3, end);
  const match = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
  return match?.[1]?.trim() || fallback;
}

function prettifySegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

async function buildOkfNav(
  bundle: typeof schema.bundles.$inferSelect,
  ref: string,
): Promise<{ tree: WikiNavNode[]; pageCount: number }> {
  const git = defaultGitEngine();
  const prefix = okfGitPathPrefix(bundle.slug);
  const files = await git.listFilesAtRef(ref, prefix);
  const docs = files.filter((p) => p.endsWith(".md"));

  const pages: WikiNavPage[] = [];
  for (const gitPath of docs) {
    const docPath = gitPath.slice(prefix.length + 1);
    const sitePath = okfDocSitePath(docPath);
    const bytes = await git.getFileAtRef(ref, gitPath);
    const markdown = bytes ? new TextDecoder().decode(bytes) : "";
    const fallback = prettifySegment(sitePath.split("/").pop() ?? sitePath);
    pages.push({
      id: `okf:${sitePath}`,
      path: sitePath,
      title: titleFromOkfMarkdown(markdown, fallback),
    });
  }

  return { tree: buildTree(pages), pageCount: pages.length };
}

/**
 * Loads the sidebar tree for a bundle.
 *
 * - `raw` mode: every non-deleted Postgres page the viewer may `view`.
 * - `llm_compiled` mode: the approved OKF knowledge tree under `okf/<slug>`
 *   (source pages are managed separately under `/sources` / the bundle page).
 */
export const getWikiNav = cache(async function getWikiNav(
  bundleSlug: string,
  viewer: AuthedUser | null,
): Promise<WikiNav | null> {
  const bundle = await db.query.bundles.findFirst({ where: eq(schema.bundles.slug, bundleSlug) });
  if (!bundle || bundle.archivedAt) return null;

  const bundleMeta = {
    id: bundle.id,
    slug: bundle.slug,
    title: bundle.title,
    isPublic: bundle.isPublic,
    mode: bundle.mode,
  };

  if (bundle.mode === "llm_compiled") {
    const allowed = await checkPermission(db, viewer, bundle, null, "view");
    if (!allowed) {
      return { bundle: bundleMeta, tree: [], pageCount: 0 };
    }
    const { tree, pageCount } = await buildOkfNav(bundle, bundle.defaultBranch);
    return { bundle: bundleMeta, tree, pageCount };
  }

  const rows = await db.query.pages.findMany({
    where: eq(schema.pages.bundleId, bundle.id),
    orderBy: asc(schema.pages.path),
  });
  const live = rows.filter((row) => !row.isDeleted);

  let visible: typeof live;
  if (viewer?.isAdmin || bundle.isPublic) {
    visible = live;
  } else if (!viewer) {
    visible = [];
  } else {
    const checks = await Promise.all(
      live.map((row) => checkPermission(db, viewer, bundle, row.path, "view")),
    );
    visible = live.filter((_, i) => checks[i]);
  }

  return {
    bundle: bundleMeta,
    tree: buildTree(visible.map((row) => ({ id: row.id, path: row.path, title: row.title }))),
    pageCount: visible.length,
  };
});

/**
 * Sidebar tree for a whole-wiki version snapshot: the page listing comes from
 * the `version/<name>` git tree, not live Postgres metadata, so the hierarchy
 * matches what the reader is actually viewing (pages added since are absent,
 * pages deleted since reappear). Titles reuse current page metadata when the
 * path still has a row (tombstoned rows included) and fall back to the
 * filename. `null` when the bundle or version doesn't exist.
 */
export async function getWikiNavForVersion(
  bundleSlug: string,
  viewer: AuthedUser | null,
  versionName: string,
): Promise<WikiNav | null> {
  if (!isValidVersionName(versionName)) return null;
  const bundle = await db.query.bundles.findFirst({ where: eq(schema.bundles.slug, bundleSlug) });
  if (!bundle || bundle.archivedAt) return null;

  const git = defaultGitEngine();
  const ref = versionBranchName(versionName);
  if ((await git.getRefOid(ref)) === null) return null;

  const bundleMeta = {
    id: bundle.id,
    slug: bundle.slug,
    title: bundle.title,
    isPublic: bundle.isPublic,
    mode: bundle.mode,
  };

  if (bundle.mode === "llm_compiled") {
    const allowed = await checkPermission(db, viewer, bundle, null, "view");
    if (!allowed) {
      return { bundle: bundleMeta, tree: [], pageCount: 0 };
    }
    const { tree, pageCount } = await buildOkfNav(bundle, ref);
    return { bundle: bundleMeta, tree, pageCount };
  }

  // Raw bundle: source pages under `raw/<slug>` in the snapshot tree, with
  // the legacy `wiki/<slug>` location as fallback for pre-migration snapshots.
  let prefix = bundleGitPathPrefix(bundle.slug);
  let files = await git.listFilesAtRef(ref, prefix);
  if (files.length === 0) {
    prefix = legacyBundleGitPathPrefix(bundle.slug);
    files = await git.listFilesAtRef(ref, prefix);
  }
  const paths = files
    .filter((gitPath) => gitPath.endsWith(".md"))
    .map((gitPath) => gitPath.slice(prefix.length + 1, -".md".length))
    .filter((pagePath) => pagePath.length > 0 && !pagePath.startsWith("_assets/"));

  let visible: string[];
  if (viewer?.isAdmin || bundle.isPublic) {
    visible = paths;
  } else if (!viewer) {
    visible = [];
  } else {
    const checks = await Promise.all(
      paths.map((pagePath) => checkPermission(db, viewer, bundle, pagePath, "view")),
    );
    visible = paths.filter((_, i) => checks[i]);
  }

  const rows = await db.query.pages.findMany({ where: eq(schema.pages.bundleId, bundle.id) });
  const rowByPath = new Map(rows.map((row) => [row.path, row]));

  const pages: WikiNavPage[] = visible.map((pagePath) => {
    const row = rowByPath.get(pagePath);
    return {
      id: row?.id ?? `git:${pagePath}`,
      path: pagePath,
      title: row?.title ?? prettifySegment(pagePath.split("/").pop() ?? pagePath),
    };
  });

  return { bundle: bundleMeta, tree: buildTree(pages), pageCount: pages.length };
}
