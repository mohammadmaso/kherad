"use client";

import { $createLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, type TextNode } from "lexical";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { createPortal } from "react-dom";

import { fetchBundle, fetchBundlePages, type PageSummary } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const MAX_SUGGESTIONS = 8;
// `[[query` — query may contain spaces but not `]`.
const PAGE_LINK_REGEX = /\[\[([^\][]{0,64})$/;

class PageLinkOption extends MenuOption {
  page: PageSummary;

  constructor(page: PageSummary) {
    super(page.id);
    this.page = page;
  }
}

/**
 * Notion/Obsidian-style internal links: typing `[[` pops a page picker for
 * the current bundle and inserts a normal markdown link to the page's
 * `/sources/<bundle-slug>/<page-path>` URL — the raw-source viewer. Compiled
 * wiki pages live under `/wiki` separately for `llm_compiled` bundles.
 */
export function PageLinkPlugin({ bundleId }: { bundleId: string }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const { t } = useI18n();
  const [query, setQuery] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [bundleSlug, setBundleSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bundle, pageRows] = await Promise.all([
          fetchBundle(bundleId),
          fetchBundlePages(bundleId),
        ]);
        if (cancelled) return;
        setBundleSlug(bundle.slug);
        setPages(pageRows);
      } catch {
        // Suggestions are best-effort; typing plain text still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  const options = useMemo(() => {
    const needle = (query ?? "").toLowerCase();
    return pages
      .filter(
        (page) =>
          needle === "" ||
          page.title.toLowerCase().includes(needle) ||
          page.path.toLowerCase().includes(needle),
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((page) => new PageLinkOption(page));
  }, [pages, query]);

  const checkForMatch = useCallback((text: string): MenuTextMatch | null => {
    const match = PAGE_LINK_REGEX.exec(text);
    if (!match) return null;
    return {
      leadOffset: match.index,
      matchingString: match[1] ?? "",
      replaceableString: match[0],
    };
  }, []);

  const onSelectOption = useCallback(
    (option: PageLinkOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      if (!bundleSlug) return;
      editor.update(() => {
        const link = $createLinkNode(`/sources/${bundleSlug}/${option.page.path}`);
        link.append($createTextNode(option.page.title));
        if (nodeToRemove) {
          nodeToRemove.replace(link);
        }
        const space = $createTextNode(" ");
        link.insertAfter(space);
        space.select();
        closeMenu();
      });
    },
    [editor, bundleSlug],
  );

  return (
    <LexicalTypeaheadMenuPlugin<PageLinkOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={checkForMatch}
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
                className="border-border bg-popover/85 animate-in fade-in zoom-in-95 mt-1.5 w-72 origin-top-start overflow-hidden rounded-lg border shadow-lg backdrop-blur-md backdrop-saturate-150 duration-150"
              >
                <ul
                  role="listbox"
                  aria-label={t.editor.linkToPage}
                  className="max-h-64 overflow-y-auto p-1"
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
                      <FileText className="text-muted-foreground size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{option.page.title}</span>
                        <span className="text-muted-foreground truncate font-mono text-xs">
                          /{option.page.path}
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
