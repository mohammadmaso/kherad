import { type AuthedUser } from "@kherad/core/auth";
import {
  bundleVersionBranchName,
  defaultGitEngine,
  isValidVersionName,
  okfDocGitPath,
  okfDocSitePath,
  userBranchName,
} from "@kherad/core/git";
import { renderMarkdownToHtml } from "@kherad/core/markdown";
import { checkPermission } from "@kherad/core/permissions";
import { schema } from "@kherad/db";
import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { parseOkfFrontmatter, renderOkfFrontmatterHtml } from "./okf-frontmatter";
import { getCachedRender, setCachedRender } from "./render-cache";

export type WikiPageResult =
  | { kind: "not-found" }
  | { kind: "forbidden"; signedIn: boolean }
  | { kind: "tombstone"; title: string }
  | { kind: "redirect"; to: string }
  | {
      /** The page row exists but its content isn't on this branch yet —
          typically written on a user branch and awaiting review/merge, or
          (when `version` is set) the page didn't exist in that snapshot. */
      kind: "unpublished";
      title: string;
      branch: string;
      /** Wiki version name being viewed, if any. */
      version: string | null;
      bundleId: string;
      pageId: string;
      canEdit: boolean;
    }
  | {
      kind: "ok";
      title: string;
      html: string;
      /** Raw markdown source, for the "Copy markdown" affordance. */
      markdown: string;
      branch: string;
      isPreview: boolean;
      /** Wiki version name being viewed, if any (content read from `version/<name>`). */
      version: string | null;
      bundleId: string;
      pageId: string;
      /** Whether the viewer may edit this page — drives the "Edit" affordance only;
          the editor routes re-check permission themselves. Compiled concept docs
          are never editable from the wiki; a `source/<path>` mirror routes edit
          to the real underlying `raw` page (see `resolveSourceEditMeta`). Version
          snapshots are always read-only. */
      canEdit: boolean;
    };

function titleFromOkfMarkdown(markdown: string, fallback: string): string {
  if (!markdown.startsWith("---")) return fallback;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return fallback;
  const fm = markdown.slice(3, end);
  const match = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
  return match?.[1]?.trim() || fallback;
}

function resourceFromOkfMarkdown(markdown: string): string | null {
  if (!markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = markdown.slice(3, end);
  const match = /^resource:\s*(.+)\s*$/m.exec(fm);
  if (!match?.[1]) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** Strip YAML frontmatter so the rendered body doesn't repeat title metadata. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return markdown;
  return markdown.slice(end + 4).replace(/^\n+/, "");
}

/**
 * Rewrite links inside compiled OKF markdown for the public wiki:
 * - bundle-relative concept links (`/concepts/x.md`) → `/wiki/<slug>/concepts/x`
 * - legacy `/sources/<slug>/…` and bare `/wiki/<slug>/…` page links → `/wiki/<slug>/source/…`
 * - leave `/wiki/<slug>/source/…`, `/api/assets/…`, and http(s) alone
 * - promote backtick-wrapped asset URLs into real markdown images
 */
function rewriteOkfWikiLinks(markdown: string, bundleSlug: string): string {
  const slug = bundleSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Promote backtick-wrapped asset URLs into real markdown images.
  const assetInBackticks = new RegExp("`(/api/assets/" + slug + "/_assets/[^`\\s]+)`", "g");
  let out = markdown.replace(assetInBackticks, (_m, url: string) => `![](${url})`);

  // Legacy source URLs from older compiles / agent output.
  out = out.replace(
    new RegExp("\\]\\(/sources/" + slug + "/([^)#?\\s]+)\\)", "g"),
    (_m, path: string) => `](/wiki/${bundleSlug}/source/${path})`,
  );

  // Bare /wiki/<slug>/<page> that aren't already under source/ → raw reference.
  out = out.replace(
    new RegExp("\\]\\(/wiki/" + slug + "/(?!source/)([^)#?\\s]+)\\)", "g"),
    (_m, path: string) => {
      if (
        path === "index" ||
        path === "log" ||
        path.startsWith("concepts/") ||
        path.startsWith("processes/") ||
        path.startsWith("glossary/") ||
        path.startsWith("guides/")
      ) {
        return `](/wiki/${bundleSlug}/${path})`;
      }
      return `](/wiki/${bundleSlug}/source/${path})`;
    },
  );

  // Bundle-relative OKF links: /concepts/foo.md → /wiki/slug/concepts/foo
  out = out.replace(
    /\]\((?!https?:\/\/|\/sources\/|\/wiki\/|\/api\/)(\/)?([^)#?\s]+?)(\.md)?(#[^)\s]*)?\)/g,
    (_match, _slash: string | undefined, path: string, _ext: string | undefined, hash = "") => {
      const cleaned = path.replace(/^\//, "").replace(/\.md$/i, "");
      if (!cleaned) return `](/wiki/${bundleSlug}/index${hash})`;
      return `](/wiki/${bundleSlug}/${cleaned}${hash})`;
    },
  );

  return out;
}

function escapeHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceLinkHtml(resourceUrl: string): string {
  // The resource URL comes from document frontmatter (indexer output, remote
  // pulls, conflict resolutions) — escape it like any other untrusted value.
  return `<p class="okf-source-link"><a href="${escapeHtmlAttribute(resourceUrl)}">View raw source</a></p>\n`;
}

function frontmatterPanelHtml(
  markdown: string,
  bundleSlug: string,
  isSourceMirror: boolean,
): string {
  if (isSourceMirror) return "";
  const frontmatter = parseOkfFrontmatter(markdown);
  if (!frontmatter) return "";
  return renderOkfFrontmatterHtml(frontmatter, bundleSlug);
}

function prettifySegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

/**
 * A wiki "source mirror" page (`source/<path>`) has no Postgres row of its
 * own — the compiled OKF doc is what's rendered — but it mirrors a real,
 * editable `raw` page. Look that page up so the wiki view can still offer a
 * working "Edit" affordance pointing at the actual editable copy. Version
 * snapshots are read-only, so callers skip this entirely when `version` is set.
 */
async function resolveSourceEditMeta(
  bundle: typeof schema.bundles.$inferSelect,
  sourcePagePath: string,
  viewer: AuthedUser | null,
): Promise<{ pageId: string; canEdit: boolean } | null> {
  const page = await db.query.pages.findFirst({
    where: and(
      eq(schema.pages.bundleId, bundle.id),
      eq(schema.pages.source, "raw"),
      eq(schema.pages.path, sourcePagePath),
    ),
  });
  if (!page || page.isDeleted) return null;
  const canEdit = viewer
    ? await checkPermission(db, viewer, bundle, sourcePagePath, "edit")
    : false;
  return { pageId: page.id, canEdit };
}

/**
 * Edit eligibility for a real compiled OKF concept doc (not a source mirror).
 * `log.md` is system-generated (the indexer's update history) and never
 * hand-editable; version snapshots are always read-only.
 */
async function resolveConceptEditMeta(
  bundle: typeof schema.bundles.$inferSelect,
  sitePath: string,
  viewer: AuthedUser | null,
  version: string | null,
): Promise<{ pageId: string; canEdit: boolean } | null> {
  if (version || sitePath === "log") return null;
  const canEdit = viewer ? await checkPermission(db, viewer, bundle, sitePath, "edit") : false;
  return { pageId: `okf:${sitePath}`, canEdit };
}

/**
 * Resolves a compiled OKF document for the public wiki surface. No Postgres
 * `pages` row — the approved `okf/<slug>` tree is the source of truth.
 */
async function resolveOkfWikiPage(
  bundle: typeof schema.bundles.$inferSelect,
  pathSegments: string[],
  viewer: AuthedUser | null,
  version: string | null,
): Promise<WikiPageResult> {
  const allowed = await checkPermission(db, viewer, bundle, null, "view");
  if (!allowed) return { kind: "forbidden", signedIn: viewer !== null };

  const sitePath = pathSegments.length === 0 ? "index" : pathSegments.join("/");
  const fallbackTitle = prettifySegment(sitePath.split("/").pop() ?? sitePath);
  // At a version snapshot, a missing doc means "not in this snapshot" — show
  // an explanatory page instead of a 404 so switching versions reads clearly.
  const notInSnapshot = (title: string): WikiPageResult =>
    version
      ? {
          kind: "unpublished",
          title,
          branch: bundleVersionBranchName(bundle.slug, version),
          version,
          bundleId: bundle.id,
          pageId: `okf:${sitePath}`,
          canEdit: false,
        }
      : { kind: "not-found" };

  const git = defaultGitEngine();
  const branch = version ? bundleVersionBranchName(bundle.slug, version) : bundle.defaultBranch;
  const commitOid = await git.getRefOid(branch);
  if (!commitOid) return notInSnapshot(fallbackTitle);

  // Raw-page fallback: at a version snapshot, read exactly that tree — never
  // scan live user branches, which would leak edits newer than the snapshot.
  const rawFallback = (pagePath: string) =>
    version
      ? git.getSourcePageAtRef(branch, bundle.slug, pagePath)
      : git.getLatestSourcePageAtRef(branch, bundle.slug, pagePath);

  // Legacy/raw page URLs (`/wiki/<slug>/kk`) → mirrored source path when the
  // path isn't a compiled concept doc.
  if (!sitePath.startsWith("source/") && sitePath !== "index" && sitePath !== "log") {
    const conceptBytes = await git.getFileAtRef(
      branch,
      okfDocGitPath(bundle.slug, `${sitePath}.md`),
    );
    if (conceptBytes === null) {
      const sourceSitePath = `source/${sitePath}`;
      const mirrored = await git.getFileAtRef(
        branch,
        okfDocGitPath(bundle.slug, `${sourceSitePath}.md`),
      );
      if (mirrored !== null) {
        const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
        return { kind: "redirect", to: `/wiki/${bundle.slug}/${sourceSitePath}${suffix}` };
      }
      // Pre-mirror compiles: still serve the live raw page under this URL so
      // resource links like /wiki/welcome/kk don't 404.
      const rawBytes = await rawFallback(sitePath);
      if (rawBytes !== null) {
        const editMeta = version ? null : await resolveSourceEditMeta(bundle, sitePath, viewer);
        return renderOkfMarkdown({
          bundle,
          sitePath: sourceSitePath,
          branch,
          version,
          commitOid,
          markdown: new TextDecoder().decode(rawBytes),
          isSourceMirror: true,
          resourceUrl: null,
          editMeta,
        });
      }
      return notInSnapshot(fallbackTitle);
    }
  }

  const docPath = `${sitePath}.md`;
  const gitPath = okfDocGitPath(bundle.slug, docPath);
  const cacheKey = { bundleId: bundle.id, path: `okf:${sitePath}`, branch, commitOid };
  const cached = getCachedRender(cacheKey);
  const isSourcePath = sitePath.startsWith("source/");

  if (cached !== undefined) {
    // Edit eligibility is per-viewer and never cached, even on an HTML hit.
    const editMeta = isSourcePath
      ? !version
        ? await resolveSourceEditMeta(bundle, sitePath.slice("source/".length), viewer)
        : null
      : await resolveConceptEditMeta(bundle, sitePath, viewer, version);
    return {
      kind: "ok",
      title: fallbackTitle,
      html: cached.html,
      markdown: cached.markdown,
      branch,
      isPreview: false,
      version,
      bundleId: bundle.id,
      pageId: editMeta?.pageId ?? `okf:${sitePath}`,
      canEdit: editMeta?.canEdit ?? false,
    };
  }

  const contentBytes = await git.getFileAtRef(branch, gitPath);

  // `/wiki/<slug>/source/<page>` with no mirror yet → fall back to live raw.
  if (contentBytes === null && isSourcePath) {
    const pagePath = sitePath.slice("source/".length);
    const rawBytes = await rawFallback(pagePath);
    if (rawBytes !== null) {
      const editMeta = version ? null : await resolveSourceEditMeta(bundle, pagePath, viewer);
      return renderOkfMarkdown({
        bundle,
        sitePath,
        branch,
        version,
        commitOid,
        markdown: new TextDecoder().decode(rawBytes),
        isSourceMirror: true,
        resourceUrl: null,
        editMeta,
      });
    }
    return notInSnapshot(fallbackTitle);
  }

  if (contentBytes === null) return notInSnapshot(fallbackTitle);

  const markdown = new TextDecoder().decode(contentBytes);
  const resource = resourceFromOkfMarkdown(markdown);
  const resourceUrl = resource
    ? resource
        .replace(new RegExp(`^/sources/${bundle.slug}/`), `/wiki/${bundle.slug}/source/`)
        .replace(new RegExp(`^/wiki/${bundle.slug}/(?!source/)`), `/wiki/${bundle.slug}/source/`)
    : null;

  const editMeta = isSourcePath
    ? !version
      ? await resolveSourceEditMeta(bundle, sitePath.slice("source/".length), viewer)
      : null
    : await resolveConceptEditMeta(bundle, sitePath, viewer, version);

  return renderOkfMarkdown({
    bundle,
    sitePath,
    branch,
    version,
    commitOid,
    markdown,
    isSourceMirror: isSourcePath,
    resourceUrl,
    editMeta,
  });
}

async function renderOkfMarkdown(args: {
  bundle: typeof schema.bundles.$inferSelect;
  sitePath: string;
  branch: string;
  version: string | null;
  commitOid: string;
  markdown: string;
  isSourceMirror: boolean;
  resourceUrl: string | null;
  /** The real editable page behind a source-mirror path, or the concept doc itself. */
  editMeta: { pageId: string; canEdit: boolean } | null;
}): Promise<Extract<WikiPageResult, { kind: "ok" }>> {
  const {
    bundle,
    sitePath,
    branch,
    version,
    commitOid,
    markdown,
    isSourceMirror,
    resourceUrl,
    editMeta,
  } = args;
  const fallbackTitle = prettifySegment(sitePath.split("/").pop() ?? sitePath);
  const cacheKey = { bundleId: bundle.id, path: `okf:${sitePath}`, branch, commitOid };
  const cached = getCachedRender(cacheKey);
  if (cached !== undefined) {
    return {
      kind: "ok",
      title: titleFromOkfMarkdown(markdown, fallbackTitle),
      html: cached.html,
      markdown: cached.markdown,
      branch,
      isPreview: false,
      version,
      bundleId: bundle.id,
      pageId: editMeta?.pageId ?? `okf:${sitePath}`,
      canEdit: editMeta?.canEdit ?? false,
    };
  }

  const title = titleFromOkfMarkdown(markdown, fallbackTitle);
  const bodyMd = isSourceMirror ? markdown : stripFrontmatter(markdown);
  const body = rewriteOkfWikiLinks(bodyMd, bundle.slug);
  let html = await renderMarkdownToHtml(body);

  const metadata = frontmatterPanelHtml(markdown, bundle.slug, isSourceMirror);
  if (metadata) {
    html = metadata + html;
  } else if (resourceUrl && !isSourceMirror) {
    html = sourceLinkHtml(resourceUrl) + html;
  }
  setCachedRender(cacheKey, { html, markdown });

  return {
    kind: "ok",
    title,
    html,
    markdown,
    branch,
    isPreview: false,
    version,
    bundleId: bundle.id,
    pageId: editMeta?.pageId ?? `okf:${sitePath}`,
    canEdit: editMeta?.canEdit ?? false,
  };
}

/**
 * Resolves a wiki page for on-demand SSR (PRD §6).
 *
 * - `llm_compiled` bundles: render approved OKF docs from `okf/<slug>`.
 * - `raw` bundles: render author source pages from Postgres + `raw/<slug>`
 *   (with legacy `wiki/<slug>` fallback).
 */
/**
 * Raw page at a bundle version snapshot. Git is the source of truth here
 * — a Postgres row only lends its title/id. Pages deleted since the snapshot
 * still render (no tombstone/redirect), and snapshot pages that never had a
 * row fall back to a filename-derived title. Snapshots are read-only, so
 * `canEdit` is always false.
 */
async function resolveRawVersionPage(
  bundle: typeof schema.bundles.$inferSelect,
  pagePath: string,
  version: string,
): Promise<WikiPageResult> {
  const branch = bundleVersionBranchName(bundle.slug, version);
  const git = defaultGitEngine();
  const commitOid = await git.getRefOid(branch);
  if (!commitOid) return { kind: "not-found" };

  const page = await db.query.pages.findFirst({
    where: and(eq(schema.pages.bundleId, bundle.id), eq(schema.pages.path, pagePath)),
  });
  const title = page?.title ?? prettifySegment(pagePath.split("/").pop() ?? pagePath);
  const okMeta = {
    bundleId: bundle.id,
    pageId: page?.id ?? `git:${pagePath}`,
    canEdit: false,
    version,
  } as const;

  const cacheKey = { bundleId: bundle.id, path: pagePath, branch, commitOid };
  const cached = getCachedRender(cacheKey);
  if (cached !== undefined) {
    return {
      kind: "ok",
      title,
      html: cached.html,
      markdown: cached.markdown,
      branch,
      isPreview: false,
      ...okMeta,
    };
  }

  const contentBytes = await git.getSourcePageAtRef(branch, bundle.slug, pagePath);
  if (contentBytes === null) {
    // Page doesn't exist in this version snapshot. Show a friendly message
    // instead of 404, so readers switching versions see why a page disappeared.
    return { kind: "unpublished", title, branch, ...okMeta };
  }

  const markdown = new TextDecoder().decode(contentBytes);
  const html = await renderMarkdownToHtml(markdown);
  setCachedRender(cacheKey, { html, markdown });

  return { kind: "ok", title, html, markdown, branch, isPreview: false, ...okMeta };
}

export async function resolveWikiPage(
  bundleSlug: string,
  pathSegments: string[],
  branchParam: string | null,
  viewer: AuthedUser | null,
  versionParam: string | null = null,
): Promise<WikiPageResult> {
  const bundle = await db.query.bundles.findFirst({ where: eq(schema.bundles.slug, bundleSlug) });
  if (!bundle || bundle.archivedAt) return { kind: "not-found" };

  // Reading at a bundle version snapshot (`version/<bundleSlug>/<name>`
  // branch). A version is published-only content, so viewing it needs no
  // extra permission beyond "view"; it wins over `?branch=` previews.
  let version: string | null = null;
  if (versionParam) {
    if (!isValidVersionName(versionParam)) return { kind: "not-found" };
    const oid = await defaultGitEngine().getRefOid(
      bundleVersionBranchName(bundle.slug, versionParam),
    );
    if (oid === null) return { kind: "not-found" };
    version = versionParam;
  }

  if (bundle.mode === "llm_compiled") {
    // Compiled wiki has no per-user preview branch — only the merged OKF tree.
    if (branchParam && !version) return { kind: "forbidden", signedIn: viewer !== null };
    return resolveOkfWikiPage(bundle, pathSegments, viewer, version);
  }

  const pagePath = pathSegments.join("/");

  if (version) {
    const allowed = await checkPermission(db, viewer, bundle, pagePath, "view");
    if (!allowed) return { kind: "forbidden", signedIn: viewer !== null };
    return resolveRawVersionPage(bundle, pagePath, version);
  }

  let branch: string;
  let isPreview = false;

  if (branchParam) {
    if (!viewer) return { kind: "forbidden", signedIn: false };
    const isBranchAuthor = branchParam === userBranchName(viewer.id);
    const isReviewer = await checkPermission(db, viewer, bundle, pagePath, "review");
    if (!isBranchAuthor && !isReviewer) return { kind: "forbidden", signedIn: true };
    branch = branchParam;
    isPreview = true;
  } else {
    const allowed = await checkPermission(db, viewer, bundle, pagePath, "view");
    if (!allowed) return { kind: "forbidden", signedIn: viewer !== null };
    branch = bundle.defaultBranch;
  }

  const page = await db.query.pages.findFirst({
    where: and(eq(schema.pages.bundleId, bundle.id), eq(schema.pages.path, pagePath)),
  });
  if (!page) return { kind: "not-found" };

  if (page.isDeleted) {
    if (page.redirectTo) {
      const suffix = isPreview ? `?branch=${encodeURIComponent(branch)}` : "";
      return { kind: "redirect", to: `/wiki/${bundleSlug}/${page.redirectTo}${suffix}` };
    }
    return { kind: "tombstone", title: page.title };
  }

  const canEdit = viewer ? await checkPermission(db, viewer, bundle, pagePath, "edit") : false;
  const okMeta = { bundleId: bundle.id, pageId: page.id, canEdit, version: null } as const;
  const unpublished = { kind: "unpublished" as const, title: page.title, branch, ...okMeta };

  const git = defaultGitEngine();
  const commitOid = await git.getRefOid(branch);
  if (!commitOid) return unpublished;

  const cacheKey = { bundleId: bundle.id, path: pagePath, branch, commitOid };
  const cached = getCachedRender(cacheKey);
  if (cached !== undefined) {
    return {
      kind: "ok",
      title: page.title,
      html: cached.html,
      markdown: cached.markdown,
      branch,
      isPreview,
      ...okMeta,
    };
  }

  const contentBytes = await git.getSourcePageAtRef(branch, bundle.slug, pagePath);
  if (contentBytes === null) return unpublished;

  const markdown = new TextDecoder().decode(contentBytes);
  const html = await renderMarkdownToHtml(markdown);
  setCachedRender(cacheKey, { html, markdown });

  return { kind: "ok", title: page.title, html, markdown, branch, isPreview, ...okMeta };
}

/** Re-export for callers that need to map an OKF git doc path to a site path. */
export { okfDocSitePath };
