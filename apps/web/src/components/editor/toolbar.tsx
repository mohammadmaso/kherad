"use client";

import {
  CODE_LANGUAGE_FRIENDLY_NAME_MAP,
  getCodeLanguages,
  $createCodeNode,
  $isCodeNode,
} from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableNode,
  INSERT_TABLE_COMMAND,
} from "@lexical/table";
import { $findMatchingParent, $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import { Button } from "@kherad/ui/components/ui/button";
import { Select } from "@kherad/ui/components/ui/select";
import {
  $createParagraphNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type TextFormatType,
} from "lexical";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Code,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  Table,
  TableColumnsSplit,
  TableRowsSplit,
  Underline,
  Undo2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/provider";

import { $createMermaidNode } from "./nodes/mermaid-node";
import { INSERT_IMAGE_UPLOAD_COMMAND } from "./plugins/images-plugin";
import { NEW_LINK_URL } from "./plugins/link-editor-plugin";

const IS_APPLE = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const MOD = IS_APPLE ? "⌘" : "Ctrl+";

type BlockType = "paragraph" | HeadingTagType | "quote" | "code" | "bullet" | "number" | "check";

function ToolbarSeparator() {
  return <div className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />;
}

export function Toolbar({ bundleId }: { bundleId?: string }) {
  const [editor] = useLexicalComposerContext();
  const { t } = useI18n();
  const [formats, setFormats] = useState<Record<string, boolean>>({});
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [isLink, setIsLink] = useState(false);
  const [inTable, setInTable] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<string | null>(null);

  const formatButtons: Array<{ format: TextFormatType; label: string; icon: ReactNode }> = [
    { format: "bold", label: `${t.editor.bold} (${MOD}B)`, icon: <Bold /> },
    { format: "italic", label: `${t.editor.italic} (${MOD}I)`, icon: <Italic /> },
    { format: "underline", label: `${t.editor.underline} (${MOD}U)`, icon: <Underline /> },
    { format: "strikethrough", label: t.editor.strikethrough, icon: <Strikethrough /> },
    { format: "code", label: t.editor.inlineCode, icon: <Code /> },
  ];

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      setCodeLanguage(null);
      return;
    }

    setFormats({
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
      code: selection.hasFormat("code"),
    });

    const anchorNode = selection.anchor.getNode();

    setIsLink($findMatchingParent(anchorNode, $isLinkNode) !== null);
    setInTable($findMatchingParent(anchorNode, $isTableNode) !== null);

    const element =
      anchorNode.getKey() === "root" ? anchorNode : anchorNode.getTopLevelElementOrThrow();
    if ($isListNode(element)) {
      const nearestList = $getNearestNodeOfType(anchorNode, ListNode);
      setBlockType((nearestList ?? element).getListType());
    } else if ($isHeadingNode(element)) {
      setBlockType(element.getTag());
    } else if ($isQuoteNode(element)) {
      setBlockType("quote");
    } else if ($isCodeNode(element)) {
      setBlockType("code");
    } else {
      setBlockType("paragraph");
    }

    const codeNode = $isCodeNode(anchorNode) ? anchorNode : anchorNode.getParent();
    if ($isCodeNode(codeNode)) {
      setCodeLanguage(codeNode.getLanguage() ?? "");
    } else {
      setCodeLanguage(null);
    }
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(updateToolbar);
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, updateToolbar]);

  function formatBlock(createNode: () => ElementNode) {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, createNode);
    });
  }

  function handleBlockTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (value === "paragraph") {
      formatBlock(() => $createParagraphNode());
    } else if (value === "quote") {
      formatBlock(() => $createQuoteNode());
    } else if (value === "code") {
      formatBlock(() => $createCodeNode());
    } else {
      formatBlock(() => $createHeadingNode(value as HeadingTagType));
    }
  }

  function toggleList(type: "bullet" | "number" | "check") {
    if (blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }
    const command =
      type === "bullet"
        ? INSERT_UNORDERED_LIST_COMMAND
        : type === "number"
          ? INSERT_ORDERED_LIST_COMMAND
          : INSERT_CHECK_LIST_COMMAND;
    editor.dispatchCommand(command, undefined);
  }

  function toggleLink() {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, isLink ? null : NEW_LINK_URL);
  }

  function insertMermaidBlock() {
    editor.update(() => {
      $insertNodes([$createMermaidNode("graph TD\n  A[Start] --> B[End]")]);
    });
  }

  function insertTable() {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: "3", rows: "3", includeHeaders: true });
  }

  function tableAction(action: () => void) {
    editor.update(action);
  }

  function handleLanguageChange(event: ChangeEvent<HTMLSelectElement>) {
    const language = event.target.value;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchorNode = selection.anchor.getNode();
      const codeNode = $isCodeNode(anchorNode) ? anchorNode : anchorNode.getParent();
      if ($isCodeNode(codeNode)) {
        codeNode.setLanguage(language);
      }
    });
  }

  return (
    <div
      data-materialize
      role="toolbar"
      aria-label={t.editor.formatting}
      className="border-border bg-background/70 sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-lg border p-1.5 shadow-sm backdrop-blur-md backdrop-saturate-150"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={`${t.editor.undo} (${MOD}Z)`}
        aria-label={t.editor.undo}
        disabled={!canUndo}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2 className="rtl:-scale-x-100" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={IS_APPLE ? `${t.editor.redo} (⌘⇧Z)` : `${t.editor.redo} (Ctrl+Y)`}
        aria-label={t.editor.redo}
        disabled={!canRedo}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <Redo2 className="rtl:-scale-x-100" />
      </Button>

      <ToolbarSeparator />

      <Select
        value={blockType}
        onChange={handleBlockTypeChange}
        aria-label={t.editor.blockType}
        className="h-7 w-32 text-xs"
      >
        <option value="paragraph">{t.editor.text}</option>
        <option value="h1">{t.editor.heading1}</option>
        <option value="h2">{t.editor.heading2}</option>
        <option value="h3">{t.editor.heading3}</option>
        <option value="quote">{t.editor.quote}</option>
        <option value="code">{t.editor.codeBlock}</option>
        <option value="h4" hidden>
          Heading 4
        </option>
        <option value="h5" hidden>
          Heading 5
        </option>
        <option value="h6" hidden>
          Heading 6
        </option>
        <option value="bullet" hidden>
          {t.editor.bulletedList}
        </option>
        <option value="number" hidden>
          {t.editor.numberedList}
        </option>
        <option value="check" hidden>
          {t.editor.checkList}
        </option>
      </Select>

      <ToolbarSeparator />

      {formatButtons.map(({ format, label, icon }) => (
        <Button
          key={format}
          type="button"
          variant={formats[format] ? "secondary" : "ghost"}
          size="icon-sm"
          title={label}
          aria-label={label}
          aria-pressed={!!formats[format]}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
        >
          {icon}
        </Button>
      ))}
      <Button
        type="button"
        variant={isLink ? "secondary" : "ghost"}
        size="icon-sm"
        title={
          isLink ? `${t.editor.removeLink} (${MOD}K)` : `${t.editor.addLink} (${MOD}K)`
        }
        aria-label={isLink ? t.editor.removeLink : t.editor.addLink}
        aria-pressed={isLink}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleLink}
      >
        <Link />
      </Button>

      <ToolbarSeparator />

      <Button
        type="button"
        variant={blockType === "bullet" ? "secondary" : "ghost"}
        size="icon-sm"
        title={t.editor.bulletedList}
        aria-label={t.editor.bulletedList}
        aria-pressed={blockType === "bullet"}
        onClick={() => toggleList("bullet")}
      >
        <List />
      </Button>
      <Button
        type="button"
        variant={blockType === "number" ? "secondary" : "ghost"}
        size="icon-sm"
        title={t.editor.numberedList}
        aria-label={t.editor.numberedList}
        aria-pressed={blockType === "number"}
        onClick={() => toggleList("number")}
      >
        <ListOrdered />
      </Button>
      <Button
        type="button"
        variant={blockType === "check" ? "secondary" : "ghost"}
        size="icon-sm"
        title={t.editor.checkList}
        aria-label={t.editor.checkList}
        aria-pressed={blockType === "check"}
        onClick={() => toggleList("check")}
      >
        <ListChecks />
      </Button>

      <ToolbarSeparator />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t.editor.divider}
        aria-label={t.editor.divider}
        onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}
      >
        <Minus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t.editor.table}
        aria-label={t.editor.table}
        onClick={insertTable}
      >
        <Table />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t.editor.mermaid}
        aria-label={t.editor.mermaid}
        onClick={insertMermaidBlock}
      >
        <Workflow />
      </Button>
      {bundleId ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t.editor.uploadImage}
          aria-label={t.editor.uploadImage}
          onClick={() => editor.dispatchCommand(INSERT_IMAGE_UPLOAD_COMMAND, undefined)}
        >
          <ImagePlus />
        </Button>
      ) : null}

      {inTable ? (
        <>
          <ToolbarSeparator />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.editor.addRowBelow}
            aria-label={t.editor.addRowBelow}
            onClick={() => tableAction(() => $insertTableRowAtSelection(true))}
          >
            <BetweenHorizontalEnd />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.editor.addColumnEnd}
            aria-label={t.editor.addColumnEnd}
            onClick={() => tableAction(() => $insertTableColumnAtSelection(true))}
          >
            <BetweenVerticalEnd className="rtl:-scale-x-100" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.editor.deleteRow}
            aria-label={t.editor.deleteRow}
            onClick={() => tableAction(() => $deleteTableRowAtSelection())}
          >
            <TableRowsSplit />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.editor.deleteColumn}
            aria-label={t.editor.deleteColumn}
            onClick={() => tableAction(() => $deleteTableColumnAtSelection())}
          >
            <TableColumnsSplit />
          </Button>
        </>
      ) : null}

      {codeLanguage !== null ? (
        <>
          <ToolbarSeparator />
          <Select
            value={codeLanguage}
            onChange={handleLanguageChange}
            aria-label={t.editor.codeLanguage}
            className="h-7 text-xs"
          >
            {getCodeLanguages().map((lang) => (
              <option key={lang} value={lang}>
                {CODE_LANGUAGE_FRIENDLY_NAME_MAP[lang] ?? lang}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </div>
  );
}
