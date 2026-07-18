import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { pagePathFromTitle } from "../page-paths";

export type PageSection = {
  id: string;
  headingText: string;
  headingLevel: number;
  orderIndex: number;
  /** Exact source substring (heading included). */
  markdown: string;
};

export type SectionSplitResult = {
  /** Content before the first top-level heading, or the whole doc when there are none. */
  preamble: string | null;
  sections: PageSection[];
  /** Min depth among top-level heading children; null when the doc has no headings. */
  topLevel: number | null;
};

type MdastPosition = {
  start?: { offset?: number | null };
  end?: { offset?: number | null };
};

type MdastNode = {
  type: string;
  depth?: number;
  children?: MdastNode[];
  value?: string;
  position?: MdastPosition;
};

function headingText(node: MdastNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(headingText).join("");
}

function normalizeTrailingNewline(chunk: string): string {
  if (!chunk) return "";
  return chunk.replace(/\s*$/, "") + "\n";
}

/**
 * Split markdown into a preamble + top-level heading sections.
 *
 * Only walks `tree.children` (true mdast top-level nodes). Headings nested
 * inside blockquotes/lists/table cells, and `#` characters inside fenced
 * code/mermaid blocks, are never treated as section boundaries.
 */
export function splitIntoSections(markdown: string): SectionSplitResult {
  if (!markdown) {
    return { preamble: null, sections: [], topLevel: null };
  }

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MdastNode;
  const children = tree.children ?? [];

  const topLevelHeadings: Array<{
    node: MdastNode;
    depth: number;
    startOffset: number;
    text: string;
  }> = [];

  for (const child of children) {
    if (child.type !== "heading" || typeof child.depth !== "number") continue;
    const startOffset = child.position?.start?.offset;
    if (typeof startOffset !== "number") continue;
    topLevelHeadings.push({
      node: child,
      depth: child.depth,
      startOffset,
      text: headingText(child),
    });
  }

  if (topLevelHeadings.length === 0) {
    return {
      preamble: markdown.length > 0 ? markdown : null,
      sections: [],
      topLevel: null,
    };
  }

  const topLevel = Math.min(...topLevelHeadings.map((h) => h.depth));
  const sectionHeadings = topLevelHeadings.filter((h) => h.depth === topLevel);

  const preambleEnd = sectionHeadings[0]!.startOffset;
  const preambleRaw = markdown.slice(0, preambleEnd);
  const preamble = preambleRaw.length > 0 ? preambleRaw : null;

  const idCounts = new Map<string, number>();
  const sections: PageSection[] = sectionHeadings.map((heading, orderIndex) => {
    const next = sectionHeadings[orderIndex + 1];
    const endOffset = next ? next.startOffset : markdown.length;
    const slice = markdown.slice(heading.startOffset, endOffset);

    const baseId = pagePathFromTitle(heading.text);
    const seen = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;

    return {
      id,
      headingText: heading.text,
      headingLevel: heading.depth,
      orderIndex,
      markdown: slice,
    };
  });

  return { preamble, sections, topLevel };
}

/**
 * Reassemble a document from a prior split, optionally overriding section
 * bodies by id. Each chunk is normalized to exactly one trailing newline.
 */
export function assembleDocument(
  split: SectionSplitResult,
  overrides: Map<string, string> = new Map(),
): string {
  const parts: string[] = [];

  if (split.preamble != null && split.preamble.length > 0) {
    parts.push(normalizeTrailingNewline(split.preamble));
  }

  for (const section of split.sections) {
    const body = overrides.get(section.id) ?? section.markdown;
    parts.push(normalizeTrailingNewline(body));
  }

  return parts.join("");
}
