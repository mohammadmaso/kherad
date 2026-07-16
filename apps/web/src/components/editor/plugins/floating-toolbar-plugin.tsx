"use client";

import { $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { Button } from "@kherad/ui/components/ui/button";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
} from "lexical";
import { Bold, Code, Italic, Link, Strikethrough, Underline } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n/provider";

import { NEW_LINK_URL } from "./link-editor-plugin";

type ToolbarState = {
  rect: DOMRect;
  formats: Record<string, boolean>;
};

export function FloatingToolbarPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { t } = useI18n();
  const [state, setState] = useState<ToolbarState | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const isPointerDownRef = useRef(false);

  const formatButtons: Array<{ format: TextFormatType; label: string; icon: ReactNode }> = [
    { format: "bold", label: t.editor.bold, icon: <Bold /> },
    { format: "italic", label: t.editor.italic, icon: <Italic /> },
    { format: "underline", label: t.editor.underline, icon: <Underline /> },
    { format: "strikethrough", label: t.editor.strikethrough, icon: <Strikethrough /> },
    { format: "code", label: t.editor.inlineCode, icon: <Code /> },
  ];

  const $updateToolbar = useCallback(() => {
    if (isPointerDownRef.current) {
      setState(null);
      return;
    }
    const selection = $getSelection();
    const nativeSelection = window.getSelection();
    const rootElement = editor.getRootElement();
    if (
      !$isRangeSelection(selection) ||
      selection.isCollapsed() ||
      selection.getTextContent() === "" ||
      !nativeSelection ||
      nativeSelection.isCollapsed ||
      !rootElement ||
      !rootElement.contains(nativeSelection.anchorNode)
    ) {
      setState(null);
      return;
    }
    const anchorNode = selection.anchor.getNode();
    // Inline formatting doesn't apply inside code blocks; the link editor owns links.
    if ($findMatchingParent(anchorNode, $isCodeNode)) {
      setState(null);
      return;
    }
    if ($findMatchingParent(anchorNode, $isLinkNode)) {
      setState(null);
      return;
    }
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    setState({
      rect,
      formats: {
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
        strikethrough: selection.hasFormat("strikethrough"),
        code: selection.hasFormat("code"),
      },
    });
  }, [editor]);

  useEffect(() => {
    const readUpdate = () => editor.getEditorState().read($updateToolbar);
    const onPointerDown = () => {
      isPointerDownRef.current = true;
      setState(null);
    };
    const onPointerUp = () => {
      isPointerDownRef.current = false;
      readUpdate();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", readUpdate);
    window.addEventListener("scroll", readUpdate, true);
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read($updateToolbar);
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("resize", readUpdate);
        window.removeEventListener("scroll", readUpdate, true);
      },
    );
  }, [editor, $updateToolbar]);

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element || !state) return;
    const { rect } = state;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    const left = Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8),
    );
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
  }, [state]);

  if (!state) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      data-materialize
      className="border-border bg-popover/85 animate-in fade-in zoom-in-95 fixed z-50 flex items-center gap-0.5 rounded-lg border p-1 shadow-lg backdrop-blur-md backdrop-saturate-150 duration-150"
      style={{ top: -9999, left: -9999 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {formatButtons.map(({ format, label, icon }) => (
        <Button
          key={format}
          type="button"
          variant={state.formats[format] ? "secondary" : "ghost"}
          size="icon-sm"
          title={label}
          aria-label={label}
          aria-pressed={!!state.formats[format]}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
        >
          {icon}
        </Button>
      ))}
      <div className="bg-border mx-0.5 h-4 w-px" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={`${t.editor.addLink} (⌘K)`}
        aria-label={t.editor.addLink}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, NEW_LINK_URL)}
      >
        <Link />
      </Button>
    </div>,
    document.body,
  );
}
