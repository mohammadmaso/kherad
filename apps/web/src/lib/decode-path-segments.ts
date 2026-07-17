/**
 * Next.js does not decode percent-encoded catch-all (`[...slug]`) route
 * segments the way it decodes single dynamic segments — a direct navigation
 * or page reload of a URL with non-ASCII characters (e.g. Persian page
 * titles) arrives here still percent-encoded (`%D9%BE%DB%8C...`), which
 * never matches a stored page path. Decode defensively: a segment that isn't
 * valid percent-encoding (a literal `%` in the path) is left as-is rather
 * than throwing.
 */
export function decodePathSegments(segments: string[]): string[] {
  return segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}
