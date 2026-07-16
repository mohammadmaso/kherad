"use client";

import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import {
  $createParagraphNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Table,
  TextQuote,
  Workflow,
} from "lucide-react";
import { useCallback, useMemo, useState, type JSX } from "react";
import { createPortal } from "react-dom";

import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

import { $createMermaidNode } from "../nodes/mermaid-node";
import { INSERT_IMAGE_UPLOAD_COMMAND } from "./images-plugin";

class SlashMenuOption extends MenuOption {
  override title: string;
  description: string;
  override icon: JSX.Element;
  keywords: string[];
  onSelect: (editor: LexicalEditor) => void;

  constructor(
    title: string,
    description: string,
    icon: JSX.Element,
    keywords: string[],
    onSelect: (editor: LexicalEditor) => void,
  ) {
    super(title);
    this.title = title;
    this.description = description;
    this.icon = icon;
    this.keywords = keywords;
    this.onSelect = onSelect;
  }
}

function formatBlockWith(createNode: () => ElementNode) {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    $setBlocksType(selection, createNode);
  }
}

function headingOption(
  tag: HeadingTagType,
  icon: JSX.Element,
  t: Dictionary,
): SlashMenuOption {
  const level = tag.slice(1);
  const title =
    level === "1" ? t.editor.heading1 : level === "2" ? t.editor.heading2 : t.editor.heading3;
  const description =
    level === "1"
      ? t.editor.largeHeading
      : level === "2"
        ? t.editor.mediumHeading
        : t.editor.smallHeading;
  return new SlashMenuOption(title, description, icon, ["heading", `h${level}`, "title"], () =>
    formatBlockWith(() => $createHeadingNode(tag)),
  );
}

function buildOptions(enableImages: boolean, t: Dictionary): SlashMenuOption[] {
  return [
    new SlashMenuOption(
      t.editor.text,
      t.editor.plainParagraph,
      <Pilcrow />,
      ["paragraph", "plain", "text"],
      () => formatBlockWith(() => $createParagraphNode()),
    ),
    headingOption("h1", <Heading1 />, t),
    headingOption("h2", <Heading2 />, t),
    headingOption("h3", <Heading3 />, t),
    new SlashMenuOption(
      t.editor.bulletedList,
      t.editor.simpleBullets,
      <List />,
      ["list", "bullet", "ul"],
      (editor) => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    ),
    new SlashMenuOption(
      t.editor.numberedList,
      t.editor.orderedList,
      <ListOrdered />,
      ["list", "numbered", "ol"],
      (editor) => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    ),
    new SlashMenuOption(
      t.editor.checkList,
      t.editor.todoList,
      <ListChecks />,
      ["todo", "task", "checkbox", "check"],
      (editor) => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
    ),
    new SlashMenuOption(
      t.editor.quote,
      t.editor.quoteDesc,
      <TextQuote />,
      ["quote", "blockquote", "callout"],
      () => formatBlockWith(() => $createQuoteNode()),
    ),
    new SlashMenuOption(
      t.editor.codeBlock,
      t.editor.codeDesc,
      <Code />,
      ["code", "snippet", "pre"],
      () => formatBlockWith(() => $createCodeNode()),
    ),
    new SlashMenuOption(
      t.editor.table,
      t.editor.tableDesc,
      <Table />,
      ["table", "grid", "rows"],
      (editor) =>
        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
          columns: "3",
          rows: "3",
          includeHeaders: true,
        }),
    ),
    new SlashMenuOption(
      t.editor.divider,
      t.editor.dividerDesc,
      <Minus />,
      ["divider", "hr", "rule", "separator"],
      (editor) => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    ),
    new SlashMenuOption(
      t.editor.mermaid,
      t.editor.mermaidDesc,
      <Workflow />,
      ["mermaid", "diagram", "flowchart", "chart"],
      () => $insertNodes([$createMermaidNode("graph TD\n  A[Start] --> B[End]")]),
    ),
    ...(enableImages
      ? [
          new SlashMenuOption(
            t.editor.image,
            t.editor.imageDesc,
            <ImagePlus />,
            ["image", "photo", "picture", "upload"],
            (editor) => editor.dispatchCommand(INSERT_IMAGE_UPLOAD_COMMAND, undefined),
          ),
        ]
      : []),
  ];
}

export function SlashMenuPlugin({ enableImages = false }: { enableImages?: boolean }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const { t } = useI18n();
  const [query, setQuery] = useState<string | null>(null);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

  const options = useMemo(() => {
    const all = buildOptions(enableImages, t);
    if (!query) return all;
    const needle = query.toLowerCase();
    return all.filter(
      (option) =>
        option.title.toLowerCase().includes(needle) ||
        option.keywords.some((keyword) => keyword.includes(needle)),
    );
  }, [query, enableImages, t]);

  const onSelectOption = useCallback(
    (
      option: SlashMenuOption,
      nodeToRemove: { remove: () => void } | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
        option.onSelect(editor);
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashMenuOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      anchorClassName="z-50"
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorElementRef.current && options.length > 0
          ? createPortal(
              <div
                data-materialize
                className="border-border bg-popover/85 animate-in fade-in zoom-in-95 mt-1.5 w-64 origin-top-start overflow-hidden rounded-lg border shadow-lg backdrop-blur-md backdrop-saturate-150 duration-150"
              >
                <ul
                  role="listbox"
                  aria-label={t.editor.insertBlock}
                  className="max-h-72 overflow-y-auto p-1"
                >
                  {options.map((option, index) => (
                    <li
                      key={option.key}
                      ref={(element) => {
                        option.setRefElement(element);
                        if (element && selectedIndex === index) {
                          element.scrollIntoView({ block: "nearest" });
                        }
                      }}
                      role="option"
                      aria-selected={selectedIndex === index}
                      className={`flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-100 ${
                        selectedIndex === index ? "bg-accent text-accent-foreground" : ""
                      }`}
                      onPointerEnter={() => setHighlightedIndex(index)}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        selectOptionAndCleanUp(option);
                      }}
                    >
                      <span className="border-border bg-background text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
                        {option.icon}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{option.title}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {option.description}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
