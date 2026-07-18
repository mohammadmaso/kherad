"use client";

import { MessageSquareQuoteIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { createTextQuote, type TextQuote } from "@/components/chat/text-quotes";
import { useI18n } from "@/lib/i18n/provider";

type ToolbarState = {
  quote: TextQuote;
  top: number;
  left: number;
};

/**
 * Floating "Add to chat" control that appears when the user selects text
 * inside `containerRef`. Positions itself above the selection.
 */
export function SelectionQuoteToolbar({
  containerRef,
  disabled,
  onAddQuote,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
  onAddQuote: (quote: TextQuote) => void;
}) {
  const { t } = useI18n();
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToolbar = useCallback(() => {
    setToolbar(null);
  }, []);

  const updateFromSelection = useCallback(() => {
    if (disabled) {
      clearToolbar();
      return;
    }
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      clearToolbar();
      return;
    }

    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if (!anchor || !focus || !container.contains(anchor) || !container.contains(focus)) {
      clearToolbar();
      return;
    }

    const text = sel.toString();
    const sectionEl = (anchor.nodeType === Node.ELEMENT_NODE
      ? (anchor as Element)
      : anchor.parentElement
    )?.closest("[data-section-heading]") as HTMLElement | null;
    const quote = createTextQuote(text, sectionEl?.dataset.sectionHeading);
    if (!quote) {
      clearToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      clearToolbar();
      return;
    }

    const top = Math.max(8, rect.top - containerRect.top + container.scrollTop - 40);
    const left = Math.min(
      Math.max(rect.left - containerRect.left + rect.width / 2, 48),
      Math.max(container.clientWidth - 48, 48),
    );

    setToolbar({ quote, top, left });
  }, [clearToolbar, containerRef, disabled]);

  useEffect(() => {
    function onPointerUp() {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      // Defer so the browser finishes updating the selection.
      hideTimerRef.current = setTimeout(updateFromSelection, 10);
    }
    function onScroll() {
      clearToolbar();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearToolbar();
    }

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    const container = containerRef.current;
    container?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      container?.removeEventListener("scroll", onScroll);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [clearToolbar, containerRef, updateFromSelection]);

  if (!toolbar) return null;

  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2"
      style={{ top: toolbar.top, left: toolbar.left }}
    >
      <button
        type="button"
        className="pointer-events-auto border-border bg-background/95 text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-md transition-[transform,opacity] duration-150 ease-out-spring active:scale-[0.97]"
        onPointerDown={(e) => {
          // Keep the selection until click completes.
          e.preventDefault();
        }}
        onClick={() => {
          onAddQuote(toolbar.quote);
          window.getSelection()?.removeAllRanges();
          clearToolbar();
        }}
      >
        <MessageSquareQuoteIcon className="size-3.5" />
        {t.agents.quoteAddToChat}
      </button>
    </div>
  );
}
