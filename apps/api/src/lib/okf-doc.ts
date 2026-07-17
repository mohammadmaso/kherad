import { normalizePagePath } from "@kherad/core/git";
import matter from "gray-matter";

/** Reserved OKF filenames that skip the frontmatter-`type` requirement and are never hand-edited via review (log.md) or edited without frontmatter (index.md). */
export const RESERVED_DOCS = new Set(["index.md", "log.md"]);

/** OKF docs that are system-generated and not exposed for direct human editing. */
export const READONLY_DOCS = new Set(["log.md"]);

export function validateDocPath(rawPath: string): string | null {
  const withoutExt = rawPath.endsWith(".md") ? rawPath.slice(0, -".md".length) : null;
  if (!withoutExt) return null;
  const normalized = normalizePagePath(withoutExt);
  return normalized ? `${normalized}.md` : null;
}

/**
 * Validates the "concept documents must start with YAML frontmatter containing at least `type`"
 * rule shared by the indexer's `write_concept_doc` tool and the human OKF-doc edit route.
 * Returns an error message when invalid, `null` when OK.
 */
export function requireFrontmatterType(docPath: string, content: string): string | null {
  if (RESERVED_DOCS.has(docPath)) return null;

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    return `Frontmatter is not valid YAML: ${String(err)}. Fix it and retry.`;
  }

  const type = parsed.data?.type;
  if (typeof type !== "string" || !type.trim()) {
    return "Missing required frontmatter field `type`. Every concept document needs a `---` YAML block with a non-empty `type`.";
  }
  return null;
}
