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

/**
 * Matches a leading YAML frontmatter block: an opening `---` line, the
 * block body, and a closing `---` line — both delimiters alone on their
 * line (only trailing spaces/tabs allowed), per `serializeOkfFrontmatter`'s
 * own output. A substring match on `---` alone is too loose: ingested
 * documents (e.g. OCR output) can contain lines like `--- Page 2 ---` that
 * are not frontmatter delimiters but would otherwise be misdetected as one,
 * swallowing real content into a bogus frontmatter block.
 */
const FRONTMATTER_BLOCK = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/;

/** Extracts the OKF YAML block when present. */
export function parseOkfFrontmatter(markdown: string): OkfFrontmatter | null {
  const match = FRONTMATTER_BLOCK.exec(markdown);
  if (!match) return null;

  const parsed = parseFrontmatterBlock(match[1] ?? "");
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

/** Strips the leading YAML frontmatter block, if any, returning just the body. */
export function stripFrontmatter(markdown: string): string {
  const match = FRONTMATTER_BLOCK.exec(markdown);
  if (!match) return markdown;
  return markdown.slice(match[0].length).replace(/^\n+/, "");
}

/** Splits markdown into its parsed frontmatter (if any) and body, for editing. */
export function splitFrontmatter(markdown: string): {
  frontmatter: OkfFrontmatter | null;
  body: string;
} {
  return { frontmatter: parseOkfFrontmatter(markdown), body: stripFrontmatter(markdown) };
}

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  return /^[\s#"'[{]|[:#]\s|[\s]$/.test(value) || /^(true|false|null|~)$/i.test(value);
}

function quoteScalar(value: string): string {
  if (!needsQuoting(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeValue(key: string, value: string | string[]): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map((item) => `  - ${quoteScalar(item)}`).join("\n")}`;
  }
  return `${key}: ${quoteScalar(value)}`;
}

/**
 * Serializes an `OkfFrontmatter` back into a `---`-delimited YAML block
 * followed by a blank line, in the same subset `parseOkfFrontmatter`
 * understands. Omits keys with no value. Known keys come first, in a fixed
 * order, followed by `extra` entries in insertion order.
 */
export function serializeOkfFrontmatter(frontmatter: OkfFrontmatter): string {
  const lines: string[] = [];

  if (frontmatter.type) lines.push(serializeValue("type", frontmatter.type));
  if (frontmatter.title) lines.push(serializeValue("title", frontmatter.title));
  if (frontmatter.description) lines.push(serializeValue("description", frontmatter.description));
  if (frontmatter.resource) lines.push(serializeValue("resource", frontmatter.resource));
  if (frontmatter.tags?.length) lines.push(serializeValue("tags", frontmatter.tags));
  if (frontmatter.timestamp) lines.push(serializeValue("timestamp", frontmatter.timestamp));

  for (const [key, value] of Object.entries(frontmatter.extra)) {
    if (Array.isArray(value) ? value.length > 0 : value) {
      lines.push(serializeValue(key, value));
    }
  }

  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** Flattens frontmatter into a plain JSON-serializable object for search_index.metadata. */
export function frontmatterToMetadata(
  frontmatter: OkfFrontmatter | null,
): Record<string, unknown> | null {
  if (!frontmatter) return null;
  const out: Record<string, unknown> = {};
  if (frontmatter.type) out.type = frontmatter.type;
  if (frontmatter.title) out.title = frontmatter.title;
  if (frontmatter.description) out.description = frontmatter.description;
  if (frontmatter.resource) out.resource = frontmatter.resource;
  if (frontmatter.tags?.length) out.tags = frontmatter.tags;
  if (frontmatter.timestamp) out.timestamp = frontmatter.timestamp;
  for (const [key, value] of Object.entries(frontmatter.extra)) {
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
