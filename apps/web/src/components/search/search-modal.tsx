"use client";

import { Dialog, DialogContent } from "@kherad/ui/components/ui/dialog";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { searchWiki, type SearchResult } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEBOUNCE_MS = 250;

export function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const requestIdRef = useRef(0);

  // Fresh palette every time it opens — a stale query from last time isn't
  // useful, and it mirrors how Spotlight/cmd-k palettes behave elsewhere.
  // Adjusted during render (not an effect) to avoid a redundant extra frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setSearched(false);
      setActiveIndex(0);
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    // Stale results just won't render — the JSX below already gates on
    // `trimmedQuery` being non-empty, so there's nothing to clear here.
    if (!trimmed) return;

    const requestId = ++requestIdRef.current;

    const timeout = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchWiki(trimmed)
        .then(({ results }) => {
          if (requestIdRef.current !== requestId) return;
          setResults(results);
          setActiveIndex(0);
          setSearched(true);
        })
        .catch((err: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setError(err instanceof Error ? err.message : t.search.failed);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [query, t.search.failed]);

  function go(result: SearchResult) {
    onOpenChange(false);
    const base = result.source === "okf" ? "/wiki" : "/sources";
    router.push(`${base}/${result.bundleSlug}/${result.path}`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) go(result);
    }
  }

  const trimmedQuery = query.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] max-w-lg -translate-y-0 gap-0 overflow-hidden p-0"
        aria-label={t.search.dialogLabel}
      >
        <div className="border-border relative border-b">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.search.placeholder}
            className="placeholder:text-muted-foreground h-12 w-full bg-transparent pe-3.5 ps-10 text-base outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {error ? <p className="text-destructive px-2.5 py-3 text-sm">{error}</p> : null}

          {!error && trimmedQuery && results.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {results.map((result, index) => (
                <li key={result.pageId}>
                  <button
                    type="button"
                    onClick={() => go(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors duration-100 ${
                      index === activeIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60"
                    }`}
                  >
                    <FileTextIcon className="size-4 shrink-0 opacity-60" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium" dir="auto">
                        {result.title}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        <span dir="auto">{result.bundleTitle}</span> ·{" "}
                        <span dir="ltr">/{result.path}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!error && !loading && trimmedQuery && searched && results.length === 0 ? (
            <p className="text-muted-foreground px-2.5 py-3 text-sm">
              {t.search.noResults(trimmedQuery)}
            </p>
          ) : null}

          {!trimmedQuery ? (
            <p className="text-muted-foreground px-2.5 py-3 text-sm">{t.search.hint}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
