/**
 * OKF frontmatter parsing/serialization lives in `@kherad/core/markdown`.
 * This module re-exports those plus the HTML renderer used by wiki SSR.
 */
export {
  parseOkfFrontmatter,
  serializeOkfFrontmatter,
  splitFrontmatter,
  stripFrontmatter,
  type OkfFrontmatter,
} from "@kherad/core/markdown";

import type { OkfFrontmatter } from "@kherad/core/markdown";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function labelForKey(key: string): string {
  return key.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

/**
 * Renders OKF metadata as an accessible HTML panel (server-side). Omits
 * `title` — the wiki page header already shows it.
 */
export function renderOkfFrontmatterHtml(
  frontmatter: OkfFrontmatter,
  bundleSlug: string,
): string {
  const rows: string[] = [];

  if (frontmatter.description) {
    rows.push(
      `<p class="okf-frontmatter-description" dir="auto">${escapeHtml(frontmatter.description)}</p>`,
    );
  }

  const grid: string[] = [];

  if (frontmatter.resource) {
    const url = frontmatter.resource
      .replace(new RegExp(`^/sources/${bundleSlug}/`), `/wiki/${bundleSlug}/source/`)
      .replace(new RegExp(`^/wiki/${bundleSlug}/(?!source/)`), `/wiki/${bundleSlug}/source/`);
    grid.push(
      `<dt>Source</dt><dd><a href="${escapeHtml(url)}">View raw source</a></dd>`,
    );
  }

  if (frontmatter.tags?.length) {
    const tags = frontmatter.tags
      .map((tag) => `<span class="okf-frontmatter-tag" dir="auto">${escapeHtml(tag)}</span>`)
      .join("");
    grid.push(`<dt>Tags</dt><dd><div class="okf-frontmatter-tags">${tags}</div></dd>`);
  }

  if (frontmatter.timestamp) {
    grid.push(
      `<dt>Updated</dt><dd dir="ltr"><time datetime="${escapeHtml(frontmatter.timestamp)}">${escapeHtml(formatTimestamp(frontmatter.timestamp))}</time></dd>`,
    );
  }

  for (const [key, value] of Object.entries(frontmatter.extra)) {
    if (Array.isArray(value)) {
      const tags = value
        .map((item) => `<span class="okf-frontmatter-tag" dir="auto">${escapeHtml(item)}</span>`)
        .join("");
      grid.push(
        `<dt>${escapeHtml(labelForKey(key))}</dt><dd><div class="okf-frontmatter-tags">${tags}</div></dd>`,
      );
    } else {
      grid.push(
        `<dt>${escapeHtml(labelForKey(key))}</dt><dd dir="auto">${escapeHtml(value)}</dd>`,
      );
    }
  }

  if (grid.length > 0) {
    rows.push(`<dl class="okf-frontmatter-grid">${grid.join("")}</dl>`);
  }

  const header: string[] = [];
  if (frontmatter.type) {
    header.push(`<span class="okf-frontmatter-type">${escapeHtml(frontmatter.type)}</span>`);
  }

  if (rows.length === 0 && header.length === 0) return "";

  const headerHtml =
    header.length > 0 ? `<div class="okf-frontmatter-header">${header.join("")}</div>` : "";

  return `<aside class="okf-frontmatter" aria-label="Document metadata">${headerHtml}${rows.join("")}</aside>`;
}
