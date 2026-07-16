/**
 * Pure page-path helpers safe for browser bundles. Kept separate from
 * `@kherad/core/git` so client components never pull in `node:fs`.
 */

/**
 * Validates a user-supplied page path (from the create/rename endpoints):
 * no leading/trailing/doubled slashes and no `.`/`..` segments — any of
 * which would produce a page whose stored path no longer round-trips
 * through URL segments. Returns the trimmed path, or null if invalid.
 */
export function normalizePagePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

/**
 * Slugifies a page title into a URL-safe path segment. Non-Latin scripts are
 * preserved; punctuation-only titles fall back to `untitled`.
 */
export function pagePathFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "untitled";

  const slug = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

/**
 * Resolves the stored page path from an explicit path and/or title. When the
 * path is blank, derives one from the title.
 */
export function resolvePagePath(input: { path?: string; title: string }): string | null {
  const trimmedPath = input.path?.trim();
  if (trimmedPath) return normalizePagePath(trimmedPath);
  return normalizePagePath(pagePathFromTitle(input.title));
}
