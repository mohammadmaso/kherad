"use client";

import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  KEY_MODIFIER_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { ExternalLink, FileText, Unlink } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { fetchBundle, fetchBundlePages, type PageSummary } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const SAFE_URL_PATTERN = /^(?:https?|mailto|tel):/i;
const WIKI_PATH_PATTERN = /^\/wiki\/[^/\s]+\/.+/;
const MAX_PAGE_SUGGESTIONS = 12;

/** Placeholder written into freshly created links until the user picks a page or URL. */
export const NEW_LINK_URL = "https://";

function isWikiPath(url: string): boolean {
  return WIKI_PATH_PATTERN.test(url.trim());
}

function looksLikeExternalUrl(value: string): boolean {
  const trimmed = value.trim();
  return SAFE_URL_PATTERN.test(trimmed) || /^www\./i.test(trimmed);
}

/** Coerce free-form input into a safe, clickable URL (blocks javascript: etc.). */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") return NEW_LINK_URL;
  if (isWikiPath(trimmed)) return trimmed;
  if (SAFE_URL_PATTERN.test(trimmed)) return trimmed;
  // Unknown explicit scheme (javascript:, data:, …) — refuse rather than link it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "about:blank";
  return `https://${trimmed}`;
}

/** Strict check used by LinkPlugin for paste-to-link and TOGGLE_LINK_COMMAND. */
export function validateUrl(url: string): boolean {
  // Placeholder used while the link editor is open — must pass or the command no-ops.
  if (url === NEW_LINK_URL) return true;
  if (isWikiPath(url)) return true;
  if (!SAFE_URL_PATTERN.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

type LinkState = {
  key: string;
  url: string;
  rect: DOMRect;
};

export function LinkEditorPlugin({ bundleId }: { bundleId?: string }): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { t } = useI18n();
  const [linkState, setLinkState] = useState<LinkState | null>(null);
  const [value, setValue] = useState("");
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [bundleSlug, setBundleSlug] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bundleId) {
      setPages([]);
      setBundleSlug(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [bundle, pageRows] = await Promise.all([
          fetchBundle(bundleId),
          fetchBundlePages(bundleId),
        ]);
        if (cancelled) return;
        setBundleSlug(bundle.slug);
        setPages(pageRows.filter((page) => !page.isDeleted));
      } catch {
        // Page picker is best-effort; external URLs still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  const $updateLinkState = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      // Keep the popover open while the user is typing in its input.
      if (popoverRef.current?.contains(document.activeElement)) return;
      setLinkState(null);
      return;
    }
    const anchorLink = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
    const focusLink = $findMatchingParent(selection.focus.getNode(), $isLinkNode);
    if (!anchorLink || anchorLink !== focusLink) {
      setLinkState(null);
      return;
    }
    const dom = editor.getElementByKey(anchorLink.getKey());
    if (!dom) {
      setLinkState(null);
      return;
    }
    setLinkState({
      key: anchorLink.getKey(),
      url: anchorLink.getURL(),
      rect: dom.getBoundingClientRect(),
    });
  }, [editor]);

  useEffect(() => {
    const remeasure = () => editor.getEditorState().read($updateLinkState);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read($updateLinkState);
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $updateLinkState();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_MODIFIER_COMMAND,
        (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return false;
            const inLink = $findMatchingParent(selection.anchor.getNode(), $isLinkNode) !== null;
            if (inLink) {
              return editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
            }
            return editor.dispatchCommand(TOGGLE_LINK_COMMAND, NEW_LINK_URL);
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
      () => {
        window.removeEventListener("resize", remeasure);
        window.removeEventListener("scroll", remeasure, true);
      },
    );
  }, [editor, $updateLinkState]);

  // Sync the input when the caret moves to a different link (or its URL changes
  // underneath us), and auto-focus the input for freshly created links.
  useEffect(() => {
    if (!linkState) {
      lastKeyRef.current = null;
      return;
    }
    if (document.activeElement !== inputRef.current) {
      // Fresh links start empty so the page picker is immediately usable.
      setValue(linkState.url === NEW_LINK_URL ? "" : linkState.url);
    }
    if (linkState.key !== lastKeyRef.current) {
      lastKeyRef.current = linkState.key;
      setHighlightedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        if (linkState.url === NEW_LINK_URL) {
          inputRef.current?.select();
        }
      });
    }
  }, [linkState]);

  const pageSuggestions = useMemo(() => {
    if (!bundleSlug || pages.length === 0) return [];
    if (looksLikeExternalUrl(value)) return [];
    const needle = value.trim().toLowerCase();
    return pages
      .filter(
        (page) =>
          needle === "" ||
          page.title.toLowerCase().includes(needle) ||
          page.path.toLowerCase().includes(needle),
      )
      .slice(0, MAX_PAGE_SUGGESTIONS);
  }, [bundleSlug, pages, value]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, pageSuggestions.length]);

  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!element || !linkState) return;
    const { rect } = linkState;
    const width = element.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    const height = element.offsetHeight;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
  }, [linkState, pageSuggestions.length]);

  if (!linkState) return null;
  const activeLink = linkState;

  function commitUrl(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const url = sanitizeUrl(trimmed);
    editor.update(() => {
      const node = $getNodeByKey(activeLink.key);
      if ($isLinkNode(node)) node.setURL(url);
    });
    editor.focus();
  }

  function selectPage(page: PageSummary) {
    if (!bundleSlug) return;
    const url = `/sources/${bundleSlug}/${page.path}`;
    editor.update(() => {
      const node = $getNodeByKey(activeLink.key);
      if (!$isLinkNode(node)) return;
      node.setURL(url);
      const text = node.getTextContent();
      if (text === "" || text === NEW_LINK_URL || text === "https://") {
        for (const child of node.getChildren()) {
          child.remove();
        }
        node.append($createTextNode(page.title));
      }
    });
    setValue(url);
    editor.focus();
  }

  function removeLink() {
    editor.update(() => {
      const node = $getNodeByKey(activeLink.key);
      if ($isLinkNode(node)) {
        for (const child of node.getChildren()) {
          node.insertBefore(child);
        }
        node.remove();
      }
    });
    editor.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && pageSuggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => (index + 1) % pageSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && pageSuggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex(
        (index) => (index - 1 + pageSuggestions.length) % pageSuggestions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlighted = pageSuggestions[highlightedIndex];
      if (highlighted && !looksLikeExternalUrl(value)) {
        selectPage(highlighted);
        return;
      }
      commitUrl(value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setValue(activeLink.url === NEW_LINK_URL ? "" : activeLink.url);
      editor.focus();
    }
  }

  const canOpenExternal = value.trim() !== "" && !isWikiPath(sanitizeUrl(value));
  const activeSuggestion = pageSuggestions[highlightedIndex];

  return createPortal(
    <div
      ref={popoverRef}
      data-materialize
      className="border-border bg-popover/85 animate-in fade-in zoom-in-95 fixed z-50 w-80 overflow-hidden rounded-lg border shadow-lg backdrop-blur-md backdrop-saturate-150 duration-150"
      style={{ top: -9999, left: -9999 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1 p-1.5">
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={bundleSlug ? t.editor.searchPagesOrUrl : t.editor.pasteOrTypeLink}
          aria-label={t.editor.linkUrl}
          aria-autocomplete={pageSuggestions.length > 0 ? "list" : undefined}
          aria-controls={pageSuggestions.length > 0 ? "link-page-suggestions" : undefined}
          aria-activedescendant={activeSuggestion ? `link-page-${activeSuggestion.id}` : undefined}
          className="focus-visible:border-ring h-7 flex-1 border-transparent bg-transparent text-xs shadow-none"
        />
        {canOpenExternal ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.editor.openLinkNewTab}
            aria-label={t.editor.openLinkNewTab}
            onClick={() => window.open(sanitizeUrl(value), "_blank", "noopener,noreferrer")}
          >
            <ExternalLink />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t.editor.removeLink}
          aria-label={t.editor.removeLink}
          onClick={removeLink}
        >
          <Unlink />
        </Button>
      </div>
      {pageSuggestions.length > 0 ? (
        <ul
          id="link-page-suggestions"
          role="listbox"
          aria-label={t.editor.linkToPage}
          className="border-border max-h-64 overflow-y-auto border-t p-1"
        >
          {pageSuggestions.map((page, index) => (
            <li
              key={page.id}
              id={`link-page-${page.id}`}
              role="option"
              aria-selected={highlightedIndex === index}
              className={`flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-100 ${
                highlightedIndex === index ? "bg-accent text-accent-foreground" : ""
              }`}
              onPointerEnter={() => setHighlightedIndex(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                selectPage(page);
              }}
            >
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{page.title}</span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  /{page.path}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>,
    document.body,
  );
}
