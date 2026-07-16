export {
  normalizePagePath,
  pagePathFromTitle,
  resolvePagePath,
} from "../page-paths";

/** Repo layout: source pages live under `/raw/<bundle-slug>/…`; compiled OKF under `/okf/<bundle-slug>/…`. */

/** Top-level git prefix for all compiled OKF documents — the subtree mirrored to the global document remote. */
export const DOCUMENTS_GIT_PATH_PREFIX = "okf";

/** Canonical git path for an author-edited source page. */
export function pageGitPath(bundleSlug: string, pagePath: string): string {
  return `raw/${bundleSlug}/${pagePath}.md`;
}

/**
 * Pre-rename layout (`wiki/<slug>/…`). Kept so existing repos still resolve
 * until every page has been re-saved into `raw/`.
 */
export function legacyPageGitPath(bundleSlug: string, pagePath: string): string {
  return `wiki/${bundleSlug}/${pagePath}.md`;
}

/** Directory prefix for a bundle's source pages (human MR / search / assets scope). */
export function bundleGitPathPrefix(bundleSlug: string): string {
  return `raw/${bundleSlug}`;
}

/** Legacy source prefix — read fallback only. */
export function legacyBundleGitPathPrefix(bundleSlug: string): string {
  return `wiki/${bundleSlug}`;
}

/**
 * The directory prefix holding a bundle's LLM-compiled OKF knowledge bundle —
 * a sibling of `raw/<slug>` so the existing prefix-scoped diff/merge
 * machinery reviews it through the normal MR flow without touching sources.
 */
export function okfGitPathPrefix(bundleSlug: string): string {
  return `okf/${bundleSlug}`;
}

/** Full git path of one OKF document (`docPath` is bundle-relative, e.g. `concepts/payroll.md`). */
export function okfDocGitPath(bundleSlug: string, docPath: string): string {
  return `okf/${bundleSlug}/${docPath}`;
}

/**
 * Site path for an OKF doc (no `.md`). `index` is the compiled wiki home;
 * `log` is the update history.
 */
export function okfDocSitePath(docPath: string): string {
  return docPath.endsWith(".md") ? docPath.slice(0, -".md".length) : docPath;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "avif",
]);

/** Whether a git path (as returned by `diffRefs`) points at a binary image asset. */
export function isImageAssetPath(gitPath: string): boolean {
  const ext = gitPath.split(".").pop()?.toLowerCase();
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}
