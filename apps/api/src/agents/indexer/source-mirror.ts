import {
  bundleGitPathPrefix,
  legacyBundleGitPathPrefix,
  okfDocGitPath,
  okfGitPathPrefix,
  type FileWrite,
  type GitEngine,
} from "@kherad/core/git";

const decoder = new TextDecoder();

/** Site URL for a raw source mirrored into the compiled wiki tree. */
export function okfSourceSitePath(bundleSlug: string, pagePath: string): string {
  return `/wiki/${bundleSlug}/source/${pagePath}`;
}

export type SourceCompileDiff = {
  /** True when there is no published index.md yet — treat as a full first compile. */
  isFirstCompile: boolean;
  added: { path: string; title: string }[];
  changed: { path: string; title: string }[];
  deleted: string[];
  unchanged: { path: string; title: string }[];
};

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Diff live source pages against the last published OKF `source/` mirror.
 * That mirror is the compile watermark — if content matches, the page does
 * not need to be recompiled.
 */
export async function diffSourcesAgainstMirror(args: {
  git: GitEngine;
  bundleSlug: string;
  defaultBranch: string;
  sourcePages: { path: string; title: string }[];
}): Promise<SourceCompileDiff> {
  const { git, bundleSlug, defaultBranch, sourcePages } = args;
  const okfPrefix = okfGitPathPrefix(bundleSlug);
  const indexExists = (await git.getFileAtRef(defaultBranch, `${okfPrefix}/index.md`)) !== null;

  const mirrored = await git.listFilesAtRef(defaultBranch, `${okfPrefix}/source`);
  const mirroredPaths = new Set(
    mirrored
      .filter((p) => p.endsWith(".md"))
      .map((p) => p.slice(`${okfPrefix}/source/`.length, -".md".length)),
  );

  if (!indexExists) {
    return {
      isFirstCompile: true,
      added: sourcePages,
      changed: [],
      deleted: [...mirroredPaths],
      unchanged: [],
    };
  }

  const livePaths = new Set(sourcePages.map((p) => p.path));
  const added: SourceCompileDiff["added"] = [];
  const changed: SourceCompileDiff["changed"] = [];
  const unchanged: SourceCompileDiff["unchanged"] = [];

  for (const page of sourcePages) {
    const live = await git.getLatestSourcePageAtRef(defaultBranch, bundleSlug, page.path);
    if (!live) continue;
    const mirrorPath = okfDocGitPath(bundleSlug, `source/${page.path}.md`);
    const mirroredBytes = await git.getFileAtRef(defaultBranch, mirrorPath);
    if (mirroredBytes === null) {
      added.push(page);
    } else if (!bytesEqual(live, mirroredBytes)) {
      changed.push(page);
    } else {
      unchanged.push(page);
    }
  }

  const deleted = [...mirroredPaths].filter((path) => !livePaths.has(path));

  return { isFirstCompile: false, added, changed, deleted, unchanged };
}

/**
 * Concept docs (non-source, non-index/log) whose `resource` points at one of
 * the given source page paths — the set the incremental agent must refresh
 * or delete.
 */
export async function listDocsLinkedToSources(args: {
  git: GitEngine;
  bundleSlug: string;
  defaultBranch: string;
  sourcePaths: string[];
}): Promise<string[]> {
  const { git, bundleSlug, defaultBranch, sourcePaths } = args;
  if (sourcePaths.length === 0) return [];
  const wanted = new Set(sourcePaths);
  const okfPrefix = okfGitPathPrefix(bundleSlug);
  const files = await git.listFilesAtRef(defaultBranch, okfPrefix);
  const linked: string[] = [];

  for (const gitPath of files) {
    if (!gitPath.endsWith(".md")) continue;
    const docPath = gitPath.slice(okfPrefix.length + 1);
    if (docPath === "index.md" || docPath === "log.md" || docPath.startsWith("source/")) continue;
    const bytes = await git.getFileAtRef(defaultBranch, gitPath);
    if (!bytes) continue;
    const pagePath = extractResourcePath(decoder.decode(bytes), bundleSlug);
    if (pagePath && wanted.has(pagePath)) linked.push(docPath);
  }

  return linked.sort();
}

/**
 * Force every concept's `resource` frontmatter onto the programmatic source
 * mirror path. Keeps other frontmatter fields intact; no-ops on docs without
 * a YAML block (index.md / log.md).
 */
export function rewriteResourceFrontmatter(
  markdown: string,
  resourceUrl: string | null,
): string {
  if (!markdown.startsWith("---") || !resourceUrl) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return markdown;
  const fm = markdown.slice(3, end);
  const body = markdown.slice(end + 4);
  const nextFm = /^resource:\s*.*$/m.test(fm)
    ? fm.replace(/^resource:\s*.*$/m, `resource: ${resourceUrl}`)
    : `${fm.replace(/\s*$/, "")}\nresource: ${resourceUrl}`;
  return `---${nextFm}\n---${body}`;
}

/**
 * Copies source pages + `_assets` into the OKF tree. When `onlyPaths` is set,
 * only those source pages are rewritten (plus deletes for `deletedPaths`);
 * unchanged mirrors are left alone for the commit overlay to restore from main.
 */
export async function buildSourceMirrorWrites(args: {
  git: GitEngine;
  bundleSlug: string;
  defaultBranch: string;
  sourcePages: { path: string; title: string }[];
  /** If set, only mirror these page paths (incremental). */
  onlyPaths?: Set<string>;
  /** Source paths that disappeared — delete their OKF mirrors. */
  deletedPaths?: string[];
}): Promise<FileWrite[]> {
  const { git, bundleSlug, defaultBranch, sourcePages, onlyPaths, deletedPaths = [] } = args;
  const writes: FileWrite[] = [];

  for (const page of sourcePages) {
    if (onlyPaths && !onlyPaths.has(page.path)) continue;
    const bytes = await git.getLatestSourcePageAtRef(defaultBranch, bundleSlug, page.path);
    if (!bytes) continue;
    writes.push({
      path: okfDocGitPath(bundleSlug, `source/${page.path}.md`),
      content: decoder.decode(bytes),
    });
  }

  for (const path of deletedPaths) {
    writes.push({
      path: okfDocGitPath(bundleSlug, `source/${path}.md`),
      content: null,
    });
  }

  // Always refresh the assets tree so new uploads are available to compiled docs.
  const prefixes = [bundleGitPathPrefix(bundleSlug), legacyBundleGitPathPrefix(bundleSlug)];
  for (const prefix of prefixes) {
    const assets = await git.listFilesAtRef(defaultBranch, `${prefix}/_assets`);
    for (const gitPath of assets) {
      const name = gitPath.slice(`${prefix}/_assets/`.length);
      if (!name) continue;
      const bytes = await git.getFileAtRef(defaultBranch, gitPath);
      if (!bytes) continue;
      writes.push({
        path: `okf/${bundleSlug}/_assets/${name}`,
        content: bytes,
      });
    }
  }

  const byPath = new Map<string, FileWrite>();
  for (const write of writes) byPath.set(write.path, write);
  return [...byPath.values()];
}

/**
 * After the LLM finishes, point every concept doc's `resource` at the
 * mirrored source page when we can infer it.
 */
export function applyResourceUrlsToPending(
  pending: Map<string, string | null>,
  bundleSlug: string,
  sourcePages: { path: string }[],
): void {
  const sourcePaths = new Set(sourcePages.map((p) => p.path));

  for (const [docPath, content] of pending) {
    if (content === null) continue;
    if (docPath === "index.md" || docPath === "log.md") continue;
    if (docPath.startsWith("source/")) continue;

    const existing = extractResourcePath(content, bundleSlug);
    let pagePath = existing;
    if (!pagePath || !sourcePaths.has(pagePath)) {
      pagePath = sourcePages.length === 1 ? sourcePages[0]!.path : pagePath;
    }
    if (!pagePath || !sourcePaths.has(pagePath)) continue;

    pending.set(
      docPath,
      rewriteResourceFrontmatter(content, okfSourceSitePath(bundleSlug, pagePath)),
    );
  }
}

/** Pull a page path out of a resource URL. */
export function extractResourcePath(markdown: string, bundleSlug: string): string | null {
  if (!markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = markdown.slice(3, end);
  const match = /^resource:\s*(.+)\s*$/m.exec(fm);
  if (!match?.[1]) return null;
  const url = match[1].trim().replace(/^["']|["']$/g, "");
  const patterns = [
    new RegExp(`^/wiki/${escapeRegExp(bundleSlug)}/source/(.+)$`),
    new RegExp(`^/sources/${escapeRegExp(bundleSlug)}/(.+)$`),
    new RegExp(`^/wiki/${escapeRegExp(bundleSlug)}/(.+)$`),
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(url);
    if (m?.[1] && !m[1].startsWith("source/")) return m[1];
    if (m?.[1]?.startsWith("source/")) return m[1].slice("source/".length);
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
