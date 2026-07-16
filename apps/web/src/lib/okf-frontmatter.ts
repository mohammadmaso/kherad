export type OkfFrontmatter = {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  /** Any additional scalar or list fields from the YAML block. */
  extra: Record<string, string | string[]>;
};

const KNOWN_KEYS = new Set(["type", "title", "description", "resource", "tags", "timestamp"]);

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((part) => unquote(part.trim())).filter(Boolean);
}

function parseFrontmatterBlock(raw: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let pendingListKey: string | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (pendingListKey && listItems.length > 0) {
      result[pendingListKey] = listItems;
    }
    pendingListKey = null;
    listItems = [];
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const listMatch = /^-\s+(.+)$/.exec(trimmed);
    if (listMatch && pendingListKey) {
      listItems.push(unquote(listMatch[1] ?? ""));
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!kvMatch) continue;

    flushList();
    const key = kvMatch[1]!;
    const value = kvMatch[2] ?? "";

    if (!value) {
      pendingListKey = key;
      continue;
    }

    const inlineList = parseInlineList(value);
    if (inlineList) {
      result[key] = inlineList;
      continue;
    }

    result[key] = unquote(value);
  }

  flushList();
  return result;
}

/** Extracts the OKF YAML block when present. */
export function parseOkfFrontmatter(markdown: string): OkfFrontmatter | null {
  if (!markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return null;

  const parsed = parseFrontmatterBlock(markdown.slice(3, end));
  if (Object.keys(parsed).length === 0) return null;

  const extra: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  const tags = parsed.tags;
  return {
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    resource: typeof parsed.resource === "string" ? parsed.resource : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
    extra,
  };
}

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
