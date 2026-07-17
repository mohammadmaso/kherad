import { renderMarkdownToText } from "../markdown/to-text";

const TARGET_CHARS = 1400;
const MAX_CHARS = 2000;
const OVERLAP_CHARS = 200;
const MAX_CHUNKS = 64;

type Section = { heading: string; body: string };

/** Split markdown into ATX heading sections (`##+`). `#` title is ignored as a break. */
function splitByHeadings(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let heading = "";
  let bodyLines: string[] = [];

  const flush = () => {
    const body = bodyLines.join("\n").trim();
    if (!heading && !body) return;
    sections.push({ heading, body });
    bodyLines = [];
  };

  for (const line of lines) {
    const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      continue;
    }
    bodyLines.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ heading: "", body: markdown.trim() }];
}

/** Pack short sections together up to TARGET_CHARS; split oversized ones on paragraphs. */
function packSections(sections: Section[]): string[] {
  const packed: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) packed.push(current.trim());
    current = "";
  };

  for (const section of sections) {
    const piece = section.heading
      ? `${section.heading}\n\n${section.body}`.trim()
      : section.body.trim();
    if (!piece) continue;

    if (piece.length > MAX_CHARS) {
      pushCurrent();
      packed.push(...splitOversized(piece));
      continue;
    }

    if (!current) {
      current = piece;
      continue;
    }

    if (current.length + 2 + piece.length <= TARGET_CHARS) {
      current = `${current}\n\n${piece}`;
    } else {
      pushCurrent();
      current = piece;
    }
  }
  pushCurrent();
  return packed;
}

/** Paragraph-boundary split with ~200-char overlap for sections that exceed MAX_CHARS. */
function splitOversized(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 2 + para.length <= MAX_CHARS) {
      current = `${current}\n\n${para}`;
    } else {
      const overlap =
        current.length > OVERLAP_CHARS ? current.slice(-OVERLAP_CHARS) : current;
      flush();
      current = `${overlap}\n\n${para}`.trim();
      if (current.length > MAX_CHARS) {
        // Hard-split if a single paragraph is still too long.
        for (let i = 0; i < current.length; i += MAX_CHARS - OVERLAP_CHARS) {
          const end = Math.min(i + MAX_CHARS, current.length);
          chunks.push(current.slice(i, end));
          if (end >= current.length) break;
        }
        current = "";
      }
    }
  }
  flush();
  return chunks;
}

/**
 * Heading-aware chunking for embedding. Returns title-prefixed plain-text
 * chunks (max 64). Empty pages yield a single title-only chunk so the page
 * still participates in semantic search.
 */
export async function chunkMarkdownForEmbedding(
  title: string,
  markdown: string,
): Promise<string[]> {
  const plain = (await renderMarkdownToText(markdown)).replaceAll("\0", "").trim();
  const sections = splitByHeadings(markdown);
  // Prefer plain-text bodies for embedding quality, but keep heading structure
  // from the markdown split by re-rendering each packed markdown chunk to text.
  const packedMd = packSections(sections);
  const texts: string[] = [];

  if (packedMd.length === 0) {
    texts.push(title.trim() || "(untitled)");
  } else {
    for (const md of packedMd) {
      const body = (await renderMarkdownToText(md)).replaceAll("\0", "").trim();
      if (!body && !plain) continue;
      texts.push(title.trim() ? `${title}\n\n${body || plain}` : body || plain);
    }
  }

  if (texts.length === 0) {
    texts.push(title.trim() || "(untitled)");
  }

  return texts.slice(0, MAX_CHUNKS);
}
