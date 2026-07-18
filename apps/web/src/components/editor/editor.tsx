"use client";

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { ReactNode } from "react";

import { cn } from "@kherad/ui/lib/utils";

import { useI18n } from "@/lib/i18n/provider";

import { ImageNode } from "./nodes/image-node";
import { MermaidNode } from "./nodes/mermaid-node";
import { CodeHighlightPlugin } from "./plugins/code-highlight-plugin";
import { FloatingToolbarPlugin } from "./plugins/floating-toolbar-plugin";
import { ImagesPlugin } from "./plugins/images-plugin";
import { LinkEditorPlugin, validateUrl } from "./plugins/link-editor-plugin";
import { PageLinkPlugin } from "./plugins/page-link-plugin";
import { SlashMenuPlugin } from "./plugins/slash-menu-plugin";
import { WordCountPlugin } from "./plugins/word-count-plugin";
import { Toolbar } from "./toolbar";
import { EDITOR_TRANSFORMERS } from "./transformers";

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  HorizontalRuleNode,
  ImageNode,
  MermaidNode,
];

const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/;
const EMAIL_REGEX =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/;

const AUTO_LINK_MATCHERS = [
  createLinkMatcherWithRegExp(URL_REGEX, (text) =>
    text.startsWith("http") ? text : `https://${text}`,
  ),
  createLinkMatcherWithRegExp(EMAIL_REGEX, (text) => `mailto:${text}`),
];

const EDITOR_THEME = {
  heading: {
    h1: "text-2xl font-bold mt-4 mb-2",
    h2: "text-xl font-bold mt-4 mb-2",
    h3: "text-lg font-semibold mt-3 mb-1",
  },
  quote: "border-s-2 border-border ps-3 italic text-muted-foreground my-2",
  list: {
    ul: "list-disc ps-6",
    ol: "list-decimal ps-6",
    listitem: "my-0.5",
    checklist: "editor-checklist",
    listitemChecked: "editor-li-checked",
    listitemUnchecked: "editor-li-unchecked",
  },
  link: "text-primary underline underline-offset-2",
  code: "block rounded-md bg-muted px-3 py-2 font-mono text-sm my-2 overflow-x-auto whitespace-pre",
  codeHighlight: {
    atrule: "editor-token-attr",
    attr: "editor-token-attr",
    boolean: "editor-token-property",
    builtin: "editor-token-selector",
    cdata: "editor-token-comment",
    char: "editor-token-selector",
    class: "editor-token-function",
    "class-name": "editor-token-function",
    comment: "editor-token-comment",
    constant: "editor-token-property",
    deleted: "editor-token-property",
    doctype: "editor-token-comment",
    entity: "editor-token-operator",
    function: "editor-token-function",
    important: "editor-token-variable",
    inserted: "editor-token-selector",
    keyword: "editor-token-attr",
    namespace: "editor-token-variable",
    number: "editor-token-property",
    operator: "editor-token-operator",
    prolog: "editor-token-comment",
    property: "editor-token-property",
    punctuation: "editor-token-punctuation",
    regex: "editor-token-variable",
    selector: "editor-token-selector",
    string: "editor-token-selector",
    symbol: "editor-token-property",
    tag: "editor-token-property",
    url: "editor-token-operator",
    variable: "editor-token-variable",
  },
  hr: "editor-hr",
  image: "inline-block max-w-full",
  table: "border-collapse my-3",
  tableCell: "border border-border px-2 py-1 text-sm align-top",
  tableCellHeader: "border border-border px-2 py-1 text-sm font-semibold bg-muted/50 align-top",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
  },
};

function onError(error: Error) {
  console.error(error);
}

export function Editor({
  initialMarkdown,
  onMarkdownChange,
  bundleId,
  contentClassName,
  className,
  children,
}: {
  initialMarkdown: string;
  onMarkdownChange?: (markdown: string) => void;
  /** Enables bundle-scoped features: image upload, page picker links, and `[[` page links. */
  bundleId?: string;
  /** Overrides the ContentEditable min-height / padding classes. */
  contentClassName?: string;
  /** Root wrapper classes (e.g. `h-full flex-1` inside a constrained flex panel). */
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const initialConfig: InitialConfigType = {
    namespace: "kherad-editor",
    nodes: EDITOR_NODES,
    onError,
    theme: EDITOR_THEME,
    editorState: () => {
      $convertFromMarkdownString(initialMarkdown, EDITOR_TRANSFORMERS);
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn("flex min-h-0 flex-col gap-2", className)}>
        <Toolbar bundleId={bundleId} />
        <div className="border-input bg-background relative min-h-[12rem] flex-1 overflow-y-auto rounded-lg border">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={
                  contentClassName ?? "min-h-[400px] px-4 py-3 text-sm outline-none"
                }
                aria-placeholder={t.editor.placeholder}
                placeholder={
                  <div className="text-muted-foreground pointer-events-none absolute start-4 top-3 text-sm">
                    {t.editor.placeholder}
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <WordCountPlugin />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <TablePlugin />
        <LinkPlugin validateUrl={validateUrl} />
        <AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />
        <ClickableLinkPlugin />
        <HorizontalRulePlugin />
        <TabIndentationPlugin />
        <CodeHighlightPlugin />
        <SlashMenuPlugin enableImages={!!bundleId} />
        <FloatingToolbarPlugin />
        <LinkEditorPlugin bundleId={bundleId} />
        {bundleId ? <ImagesPlugin bundleId={bundleId} /> : null}
        {bundleId ? <PageLinkPlugin bundleId={bundleId} /> : null}
        <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
        {onMarkdownChange ? (
          <OnChangePlugin
            onChange={(editorState) => {
              editorState.read(() => {
                onMarkdownChange($convertToMarkdownString(EDITOR_TRANSFORMERS));
              });
            }}
          />
        ) : null}
        {children}
      </div>
    </LexicalComposer>
  );
}
