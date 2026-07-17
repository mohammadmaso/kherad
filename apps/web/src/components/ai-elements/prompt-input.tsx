"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { cn } from "@kherad/ui/lib/utils";
import { ArrowUpIcon, AtSignIcon, FileTextIcon, SquareIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { MAX_MENTIONS_PER_MESSAGE, type MentionPage } from "@/components/chat/page-mentions";

const MAX_SUGGESTIONS = 8;
// A trailing "@token" at the caret opens the page picker, mirroring the
// editor's "[[" page-link trigger.
const AT_TRIGGER_REGEX = /(^|\s)@([^\s@]{0,64})$/;

export type MentionLabels = {
  add: string;
  searchPlaceholder: string;
  empty: string;
};

type PromptInputProps = {
  placeholder: string;
  submitLabel: string;
  stopLabel: string;
  /** "streaming"/"submitted" turn the send button into a stop button. */
  status: "ready" | "submitted" | "streaming" | "error";
  disabled?: boolean;
  className?: string;
  /** Wiki pages offered by the "@" picker; omit to disable mentions. */
  mentionPages?: MentionPage[];
  mentionLabels?: MentionLabels;
  onSubmit: (text: string, mentions: MentionPage[]) => void;
  onStop: () => void;
};

/**
 * Chat composer: Enter sends, Shift+Enter breaks the line, streaming swaps
 * send for stop. When `mentionPages` is provided, an @-button and typing "@"
 * open a page picker; chosen pages attach to the message as chips.
 */
export function PromptInput({
  placeholder,
  submitLabel,
  stopLabel,
  status,
  disabled,
  className,
  mentionPages,
  mentionLabels,
  onSubmit,
  onStop,
}: PromptInputProps) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionPage[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // Query typed after "@" in the textarea, or in the picker's own search box.
  const [query, setQuery] = useState("");
  const [fromAtTrigger, setFromAtTrigger] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const busy = status === "submitted" || status === "streaming";
  const mentionsEnabled = mentionPages !== undefined;

  const suggestions = useMemo(() => {
    if (!mentionPages) return [];
    const q = query.trim().toLowerCase();
    const taken = new Set(mentions.map((m) => `${m.bundleSlug}:${m.path}`));
    return mentionPages
      .filter((page) => !taken.has(`${page.bundleSlug}:${page.path}`))
      .filter(
        (page) =>
          !q ||
          page.title.toLowerCase().includes(q) ||
          page.path.toLowerCase().includes(q) ||
          (page.bundleTitle ?? "").toLowerCase().includes(q),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [mentionPages, mentions, query]);

  useEffect(() => {
    if (!menuOpen) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, menuOpen]);

  // Light-dismiss: close the picker when the pointer goes down outside it.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    setFromAtTrigger(false);
    setQuery("");
  }

  function addMention(page: MentionPage) {
    if (mentions.length >= MAX_MENTIONS_PER_MESSAGE) return;
    setMentions((prev) => [...prev, page]);
    if (fromAtTrigger) {
      // Remove the "@query" token that opened the picker.
      setText((prev) => prev.replace(AT_TRIGGER_REGEX, "$1"));
    }
    closeMenu();
    textareaRef.current?.focus();
  }

  function removeMention(page: MentionPage) {
    setMentions((prev) =>
      prev.filter((m) => !(m.bundleSlug === page.bundleSlug && m.path === page.path)),
    );
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSubmit(trimmed, mentions);
    setText("");
    setMentions([]);
    closeMenu();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleTextChange(value: string) {
    setText(value);
    if (!mentionsEnabled) return;
    const match = AT_TRIGGER_REGEX.exec(value);
    if (match) {
      setMenuOpen(true);
      setFromAtTrigger(true);
      setQuery(match[2] ?? "");
      setHighlight(0);
    } else if (fromAtTrigger) {
      closeMenu();
    }
  }

  function handleMenuKeys(e: KeyboardEvent): boolean {
    if (!menuOpen) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const page = suggestions[highlight];
      if (page) {
        e.preventDefault();
        addMention(page);
        return true;
      }
      return false;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return true;
    }
    return false;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (handleMenuKeys(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className={cn(
        "border-border bg-background focus-within:border-ring relative flex flex-col rounded-xl border p-2 transition-colors duration-150",
        className,
      )}
    >
      {menuOpen && mentionsEnabled ? (
        <div className="border-border bg-popover text-popover-foreground absolute bottom-full start-0 z-20 mb-2 w-full max-w-80 origin-bottom overflow-hidden rounded-xl border shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
          {!fromAtTrigger ? (
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => void handleMenuKeys(e)}
              placeholder={mentionLabels?.searchPlaceholder}
              className="border-border placeholder:text-muted-foreground w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
            />
          ) : null}
          <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
            {suggestions.length === 0 ? (
              <p className="text-muted-foreground px-2.5 py-2 text-xs">{mentionLabels?.empty}</p>
            ) : (
              suggestions.map((page, index) => (
                <button
                  key={`${page.bundleSlug}:${page.path}`}
                  type="button"
                  data-active={index === highlight}
                  onPointerEnter={() => setHighlight(index)}
                  onClick={() => addMention(page)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-start transition-colors duration-100",
                    index === highlight ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="flex w-full items-center gap-1.5 text-sm">
                    <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate">{page.title}</span>
                  </span>
                  <span className="text-muted-foreground w-full truncate ps-5 text-xs" dir="ltr">
                    {page.bundleTitle ? `${page.bundleTitle} · ` : ""}
                    {page.path}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {mentions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {mentions.map((mention) => (
            <span
              key={`${mention.bundleSlug}:${mention.path}`}
              className="bg-muted inline-flex max-w-56 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            >
              <FileTextIcon className="size-3 shrink-0" />
              <span className="truncate">{mention.title}</span>
              <button
                type="button"
                aria-label={`${mention.title} ×`}
                className="text-muted-foreground hover:text-foreground transition-colors duration-100"
                onClick={() => removeMention(mention)}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {mentionsEnabled ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={mentionLabels?.add}
            title={mentionLabels?.add}
            disabled={disabled || mentions.length >= MAX_MENTIONS_PER_MESSAGE}
            onClick={() => {
              if (menuOpen) {
                closeMenu();
              } else {
                setMenuOpen(true);
                setFromAtTrigger(false);
                setQuery("");
                setHighlight(0);
                requestAnimationFrame(() => searchRef.current?.focus());
              }
            }}
          >
            <AtSignIcon className="size-4" />
          </Button>
        ) : null}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="placeholder:text-muted-foreground max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none disabled:opacity-50"
        />
        {busy ? (
          <Button type="button" size="icon-sm" variant="outline" aria-label={stopLabel} onClick={onStop}>
            <SquareIcon className="size-3.5" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            aria-label={submitLabel}
            disabled={disabled || !text.trim()}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
