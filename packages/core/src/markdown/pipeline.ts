import type { Element, ElementContent, Root as HastRoot } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { bundledLanguages, codeToHtml, type BundledLanguage } from "shiki";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** Matches the theme baked into the editor's own preview surfaces for visual consistency. */
const SHIKI_THEME = "github-dark";

function isElement(node: unknown): node is Element {
  return typeof node === "object" && node !== null && (node as Element).type === "element";
}

export function textContent(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

function codeLanguage(codeNode: Element): string | undefined {
  const classNames = (codeNode.properties?.className as string[] | undefined) ?? [];
  const languageClass = classNames.find((name) => name.startsWith("language-"));
  return languageClass?.slice("language-".length);
}

function resolveShikiLang(requested: string | undefined): BundledLanguage | "text" {
  if (requested && requested in bundledLanguages) return requested as BundledLanguage;
  return "text";
}

/**
 * Fenced ```mermaid blocks must reach the client untouched (raw diagram
 * source, no syntax highlighting) — per PRD §6/§12, Mermaid renders
 * client-side post-hydration, never on the server. Must run before
 * `rehypeShikiHighlight` so Shiki never sees these blocks.
 */
function rehypeMermaidPassthrough() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      const codeNode = node.children.find(isElement);
      if (!codeNode || codeNode.tagName !== "code" || codeLanguage(codeNode) !== "mermaid") return;

      const replacement: Element = {
        type: "element",
        tagName: "pre",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value: textContent(codeNode) }],
      };
      parent.children[index] = replacement;
    });
  };
}

/**
 * Server-side syntax highlighting via Shiki (PRD §6). Each fenced code block
 * is re-rendered as themed HTML and spliced back in as a `raw` hast node;
 * `rehypeRaw` (run immediately after, see `renderMarkdownToHtml`) parses
 * those raw nodes into real hast elements before stringification.
 */
function rehypeShikiHighlight() {
  return async (tree: HastRoot) => {
    const tasks: Array<() => Promise<void>> = [];

    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      const codeNode = node.children.find(isElement);
      if (!codeNode || codeNode.tagName !== "code") return;

      const lang = resolveShikiLang(codeLanguage(codeNode));
      const source = textContent(codeNode);

      tasks.push(async () => {
        let html: string;
        try {
          html = await codeToHtml(source, { lang, theme: SHIKI_THEME });
        } catch {
          html = await codeToHtml(source, { lang: "text", theme: SHIKI_THEME });
        }
        parent.children[index] = { type: "raw", value: html } as unknown as ElementContent;
      });
    });

    for (const task of tasks) await task();
  };
}

/**
 * Wiki pages routinely mix Persian and English (or other RTL/LTR scripts)
 * paragraph by paragraph. `dir="auto"` makes each block resolve its own
 * bidi direction from its own text via the browser's UA algorithm, instead
 * of the whole page inheriting one fixed direction from `<html dir>`
 * (locale-driven, not content-driven — see apps/web/src/app/layout.tsx).
 * Code must stay LTR regardless of surrounding content language.
 */
const AUTO_DIRECTION_TAGS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "td",
  "th",
  "dd",
  "dt",
  "figcaption",
  "caption",
]);
const FORCE_LTR_TAGS = new Set(["pre", "code"]);

function rehypeContentDirection() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node) => {
      if (node.properties && "dir" in node.properties) return;

      if (FORCE_LTR_TAGS.has(node.tagName)) {
        node.properties = { ...node.properties, dir: "ltr" };
      } else if (AUTO_DIRECTION_TAGS.has(node.tagName)) {
        node.properties = { ...node.properties, dir: "auto" };
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeMermaidPassthrough)
  .use(rehypeShikiHighlight)
  .use(rehypeRaw)
  .use(rehypeContentDirection)
  .use(rehypeStringify);

/**
 * Renders wiki-page Markdown to HTML for server-side rendering: headings,
 * nested lists, tables (via GFM), and Shiki-highlighted code blocks are
 * fully rendered server-side; ```mermaid fences pass through as raw source
 * inside `<pre class="mermaid">` for client-side rendering post-hydration.
 */
export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
