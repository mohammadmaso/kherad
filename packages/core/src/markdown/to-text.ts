import type { ElementContent, Root as HastRoot } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { textContent } from "./pipeline";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

/**
 * Extracts plain, whitespace-collapsed text from Markdown for the search
 * index — same remark/GFM parse as `renderMarkdownToHtml`, but skips
 * Shiki/Mermaid handling (irrelevant for a bag-of-words index) and
 * stringifies to text instead of HTML.
 */
export async function renderMarkdownToText(markdown: string): Promise<string> {
  const hast = (await processor.run(processor.parse(markdown))) as HastRoot;
  // remark-rehype output never contains a `doctype` node (that only comes
  // from parsing a full HTML document), so `RootContent` narrows to `ElementContent` here.
  return hast.children
    .map((child) => textContent(child as ElementContent))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
