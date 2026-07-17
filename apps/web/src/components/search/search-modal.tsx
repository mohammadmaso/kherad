"use client";

import { Dialog, DialogContent } from "@kherad/ui/components/ui/dialog";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  searchWiki,
  type SearchMode,
  type SearchResult,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const DEBOUNCE_MS = 250;
const SEMANTIC_DEBOUNCE_MS = 400;
const MODE_STORAGE_KEY = "kherad.searchMode";
const MODES: SearchMode[] = ["keyword", "semantic", "hybrid"];

const modeListeners = new Set<() => void>();

function getStoredMode(): SearchMode {
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw === "keyword" || raw === "semantic" || raw === "hybrid") return raw;
  } catch {
    /* ignore */
  }
  return "hybrid";
}

function subscribeModeStorage(onStoreChange: () => void) {
  modeListeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODE_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    modeListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function persistMode(next: SearchMode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  for (const listener of modeListeners) listener();
}

/** Split snippet on ⟪…⟫ markers into plain / highlight spans. */
function SnippetText({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(⟪.*?⟫)/g).filter(Boolean);
  return (
    <span dir="auto">
      {parts.map((part, i) =>
        part.startsWith("⟪") && part.endsWith("⟫") ? (
          <mark
            key={i}
            className="bg-primary/15 text-foreground rounded-sm px-0.5"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

function ScoreChip({
  result,
  mode,
  label,
}: {
  result: SearchResult;
  mode: SearchMode;
  label: string;
}) {
  const scores = result.scores;
  if (!scores) return null;

  let primary: string;
  let detail: string | null = null;

  if (mode === "keyword") {
    primary = (scores.keyword ?? result.rank).toFixed(2);
  } else if (mode === "semantic") {
    const sim = scores.semantic ?? result.rank;
    primary = `${Math.round(sim * 100)}%`;
  } else {
    primary = scores.combined.toFixed(3);
    const k = scores.keyword != null ? scores.keyword.toFixed(2) : "—";
    const s =
      scores.semantic != null ? `${Math.round(scores.semantic * 100)}%` : "—";
    detail = `K ${k} · S ${s}`;
  }

  return (
    <span
      className="text-muted-foreground ms-auto flex shrink-0 flex-col items-end gap-0.5 text-[10px] leading-tight tabular-nums"
      title={label}
    >
      <span className="bg-muted/80 rounded px-1.5 py-0.5 font-medium">{primary}</span>
      {detail ? <span className="opacity-70">{detail}</span> : null}
    </span>
  );
}

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
  const mode = useSyncExternalStore(
    subscribeModeStorage,
    getStoredMode,
    () => "hybrid" as SearchMode,
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [semanticAvailable, setSemanticAvailable] = useState(true);

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

  function selectMode(next: SearchMode) {
    if ((next === "semantic" || next === "hybrid") && !semanticAvailable) return;
    persistMode(next);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchWiki("", mode)
      .then(({ semanticAvailable: available }) => {
        if (!cancelled) setSemanticAvailable(available);
      })
      .catch(() => {
        /* ignore probe errors */
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const requestId = ++requestIdRef.current;
    const debounce = mode === "keyword" ? DEBOUNCE_MS : SEMANTIC_DEBOUNCE_MS;

    const timeout = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchWiki(trimmed, mode)
        .then(({ results: next, semanticAvailable: available }) => {
          if (requestIdRef.current !== requestId) return;
          setResults(next);
          setSemanticAvailable(available);
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
    }, debounce);

    return () => clearTimeout(timeout);
  }, [query, mode, t.search.failed]);

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
  const modeDisabled = !semanticAvailable;

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

        <div
          className="border-border flex gap-1 border-b px-2.5 py-1.5"
          role="radiogroup"
          aria-label={t.search.modeLabel}
        >
          {MODES.map((m) => {
            const disabled =
              modeDisabled && (m === "semantic" || m === "hybrid");
            const active = mode === m;
            const label =
              m === "keyword"
                ? t.search.modeKeyword
                : m === "semantic"
                  ? t.search.modeSemantic
                  : t.search.modeHybrid;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => selectMode(m)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {modeDisabled && (mode === "semantic" || mode === "hybrid") ? (
          <p className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs">
            {t.search.semanticUnavailable}
          </p>
        ) : null}

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
                    className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors duration-100 ease-out active:scale-[0.99] ${
                      index === activeIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60"
                    }`}
                  >
                    <FileTextIcon className="mt-0.5 size-4 shrink-0 opacity-60" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-start gap-2">
                        <span className="truncate text-sm font-medium" dir="auto">
                          {result.title}
                        </span>
                        <ScoreChip
                          result={result}
                          mode={mode}
                          label={t.search.scoreLabel}
                        />
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        <span dir="auto">{result.bundleTitle}</span> ·{" "}
                        <span dir="ltr">/{result.path}</span>
                      </span>
                      {result.snippet ? (
                        <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                          <SnippetText snippet={result.snippet} />
                        </span>
                      ) : null}
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
