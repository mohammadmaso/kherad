"use client";

import { isBinaryConflictToken } from "@kherad/core/binary-conflict";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { cn } from "@kherad/ui/lib/utils";
import { diffLines } from "diff";
import { Check, Columns2, AlignLeft, Pencil, Rows2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  assembleResolvedText,
  conflictHunks,
  parseConflictMarkers,
  type HunkResolution,
} from "@/lib/conflict-diff";
import { useI18n } from "@/lib/i18n/provider";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type ViewMode = "side-by-side" | "integrated";
type ChangeChoice = "ours" | "theirs" | "both";

type SameBlock = { kind: "same"; lines: string[] };
type ChangeBlock = { kind: "change"; id: string; index: number; ours: string[]; theirs: string[] };
type DiffBlock = SameBlock | ChangeBlock;

type SideCell = {
  text: string | null;
  kind: "same" | "changed" | "empty";
  lineNo: number | null;
};

type AlignedRow = { left: SideCell; right: SideCell; changeId: string | null };

function splitPartLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Split ours/theirs into same-line runs and discrete change blocks. */
function splitChangeBlocks(ours: string, theirs: string): DiffBlock[] {
  const parts = diffLines(ours, theirs);
  const blocks: DiffBlock[] = [];
  let changeIndex = 0;
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;

    if (!part.added && !part.removed) {
      const lines = splitPartLines(part.value);
      if (lines.length > 0) blocks.push({ kind: "same", lines });
      i += 1;
      continue;
    }

    if (part.removed) {
      const oursLines = splitPartLines(part.value);
      const next = parts[i + 1];
      const theirsLines = next?.added ? splitPartLines(next.value) : [];
      blocks.push({
        kind: "change",
        id: `c-${changeIndex}`,
        index: changeIndex,
        ours: oursLines,
        theirs: theirsLines,
      });
      changeIndex += 1;
      i += theirsLines.length > 0 || next?.added ? 2 : 1;
      continue;
    }

    blocks.push({
      kind: "change",
      id: `c-${changeIndex}`,
      index: changeIndex,
      ours: [],
      theirs: splitPartLines(part.value),
    });
    changeIndex += 1;
    i += 1;
  }

  return blocks;
}

function assembleFromChoices(blocks: DiffBlock[], choices: Record<string, ChangeChoice>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === "same") {
      parts.push(...block.lines);
      continue;
    }
    const choice = choices[block.id];
    if (!choice) continue;
    if (choice === "ours") parts.push(...block.ours);
    else if (choice === "theirs") parts.push(...block.theirs);
    else parts.push(...block.ours, ...block.theirs);
  }
  return parts.join("\n");
}

/** Align ours/theirs into paired side-by-side rows, tagged with change ids. */
function alignSides(blocks: DiffBlock[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  let leftNo = 1;
  let rightNo = 1;

  for (const block of blocks) {
    if (block.kind === "same") {
      for (const text of block.lines) {
        rows.push({
          left: { text, kind: "same", lineNo: leftNo++ },
          right: { text, kind: "same", lineNo: rightNo++ },
          changeId: null,
        });
      }
      continue;
    }

    const max = Math.max(block.ours.length, block.theirs.length);
    for (let j = 0; j < max; j++) {
      const leftText = block.ours[j] ?? null;
      const rightText = block.theirs[j] ?? null;
      rows.push({
        left:
          leftText === null
            ? { text: null, kind: "empty", lineNo: null }
            : { text: leftText, kind: "changed", lineNo: leftNo++ },
        right:
          rightText === null
            ? { text: null, kind: "empty", lineNo: null }
            : { text: rightText, kind: "changed", lineNo: rightNo++ },
        changeId: block.id,
      });
    }
  }

  return rows;
}

function ContextBlock({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div className="relative px-4 py-3">
      <div aria-hidden className="bg-border/50 absolute inset-y-3 start-0 w-px" />
      <pre
        className="text-muted-foreground font-mono text-[12.5px] leading-5 whitespace-pre-wrap"
        dir="auto"
      >
        {trimmed}
      </pre>
    </div>
  );
}

function DiffLine({ cell, side }: { cell: SideCell; side: "ours" | "theirs" }) {
  const isOurs = side === "ours";
  return (
    <div
      className={cn(
        "grid min-h-[1.75rem] grid-cols-[2.5rem_minmax(0,1fr)] items-start font-mono text-[12.5px] leading-5",
        cell.kind === "changed" &&
          (isOurs
            ? "bg-rose-500/[0.1] dark:bg-rose-400/[0.14]"
            : "bg-emerald-500/[0.1] dark:bg-emerald-400/[0.14]"),
        cell.kind === "empty" && "bg-muted/20",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground/65 select-none border-e pe-2 pt-1 text-end tabular-nums",
          cell.kind === "changed"
            ? isOurs
              ? "border-rose-500/20 text-rose-700/75 dark:text-rose-300/75"
              : "border-emerald-500/20 text-emerald-700/75 dark:text-emerald-300/75"
            : "border-border/40",
        )}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        className={cn(
          "min-w-0 whitespace-pre-wrap break-words px-2.5 py-1",
          cell.kind === "empty" && "opacity-0",
          cell.kind === "changed" &&
            (isOurs
              ? "text-rose-950 dark:text-rose-50"
              : "text-emerald-950 dark:text-emerald-50"),
        )}
        dir="auto"
      >
        {cell.kind === "changed" ? (
          <span
            aria-hidden
            className={cn(
              "me-1.5 inline-block w-2 select-none font-semibold",
              isOurs ? "text-rose-500" : "text-emerald-500",
            )}
          >
            {isOurs ? "−" : "+"}
          </span>
        ) : null}
        {cell.text ?? "\u00a0"}
      </span>
    </div>
  );
}

function ChangeActions({
  choice,
  onChoose,
  t,
  compact,
}: {
  choice: ChangeChoice | undefined;
  onChoose: (choice: ChangeChoice) => void;
  t: Dictionary;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "px-2 py-1.5" : "px-3 py-2")}>
      <Button
        type="button"
        size="sm"
        variant={choice === "ours" ? "default" : "outline"}
        className={cn(
          "h-7 gap-1 px-2.5 text-xs transition-all duration-200 ease-[var(--ease-out-spring)]",
          choice === "ours" && "bg-rose-600 hover:bg-rose-600/90",
        )}
        onClick={() => onChoose("ours")}
      >
        {choice === "ours" ? <Check className="size-3 stroke-[3]" /> : null}
        {t.mr.acceptCurrent}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={choice === "theirs" ? "default" : "outline"}
        className={cn(
          "h-7 gap-1 px-2.5 text-xs transition-all duration-200 ease-[var(--ease-out-spring)]",
          choice === "theirs" && "bg-emerald-600 hover:bg-emerald-600/90",
        )}
        onClick={() => onChoose("theirs")}
      >
        {choice === "theirs" ? <Check className="size-3 stroke-[3]" /> : null}
        {t.mr.acceptIncoming}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={choice === "both" ? "default" : "ghost"}
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => onChoose("both")}
      >
        {choice === "both" ? <Check className="size-3 stroke-[3]" /> : null}
        {t.mr.acceptBoth}
      </Button>
    </div>
  );
}

function IntegratedLine({
  text,
  side,
}: {
  text: string;
  side: "ours" | "theirs" | "same";
}) {
  return (
    <div
      className={cn(
        "grid min-h-[1.75rem] grid-cols-[1.25rem_minmax(0,1fr)] items-start font-mono text-[12.5px] leading-5",
        side === "ours" && "bg-rose-500/[0.1] dark:bg-rose-400/[0.14]",
        side === "theirs" && "bg-emerald-500/[0.1] dark:bg-emerald-400/[0.14]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "select-none pt-1 text-center font-semibold",
          side === "ours" && "text-rose-500",
          side === "theirs" && "text-emerald-500",
          side === "same" && "text-transparent",
        )}
      >
        {side === "ours" ? "−" : side === "theirs" ? "+" : "·"}
      </span>
      <span
        className={cn(
          "min-w-0 whitespace-pre-wrap break-words pe-3 py-1",
          side === "ours" && "text-rose-950 dark:text-rose-50",
          side === "theirs" && "text-emerald-950 dark:text-emerald-50",
          side === "same" && "text-foreground/80",
        )}
        dir="auto"
      >
        {text || "\u00a0"}
      </span>
    </div>
  );
}

function IntegratedDiff({
  blocks,
  choices,
  onChoose,
  t,
}: {
  blocks: DiffBlock[];
  choices: Record<string, ChangeChoice>;
  onChoose: (changeId: string, choice: ChangeChoice) => void;
  t: Dictionary;
}) {
  return (
    <div className="overflow-x-auto">
      {blocks.map((block, blockIndex) => {
        if (block.kind === "same") {
          return (
            <div key={`same-${blockIndex}`}>
              {block.lines.map((line, lineIndex) => (
                <IntegratedLine key={lineIndex} text={line} side="same" />
              ))}
            </div>
          );
        }

        const choice = choices[block.id];
        const showOurs = !choice || choice === "ours" || choice === "both";
        const showTheirs = !choice || choice === "theirs" || choice === "both";

        return (
          <div
            key={block.id}
            className={cn(
              "border-y first:border-t-0",
              "transition-[border-color,background-color] duration-300 ease-[var(--ease-out-spring)]",
              choice
                ? "border-emerald-500/25 bg-emerald-500/[0.03]"
                : "border-amber-500/30 bg-amber-500/[0.04]",
            )}
          >
            <div className="border-border/50 flex flex-wrap items-center justify-between gap-2 border-b bg-background/50 px-3 py-1.5">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t.mr.changeLabel(block.index + 1)}
                {choice ? (
                  <span className="ms-2 normal-case text-emerald-700 dark:text-emerald-300">
                    · {t.mr.resolved}
                  </span>
                ) : null}
              </span>
              <ChangeActions
                choice={choice}
                onChoose={(c) => onChoose(block.id, c)}
                t={t}
                compact
              />
            </div>

            {showOurs
              ? block.ours.map((line, lineIndex) => (
                  <IntegratedLine key={`o-${lineIndex}`} text={line} side="ours" />
                ))
              : null}
            {showTheirs
              ? block.theirs.map((line, lineIndex) => (
                  <IntegratedLine key={`t-${lineIndex}`} text={line} side="theirs" />
                ))
              : null}
            {block.ours.length === 0 && block.theirs.length === 0 ? (
              <div className="text-muted-foreground px-3 py-2 text-xs italic">{t.mr.emptyPreview}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SideBySideDiff({
  blocks,
  rows,
  choices,
  onChoose,
  onAcceptAll,
  t,
  oursLabel,
  theirsLabel,
}: {
  blocks: DiffBlock[];
  rows: AlignedRow[];
  choices: Record<string, ChangeChoice>;
  onChoose: (changeId: string, choice: ChangeChoice) => void;
  onAcceptAll: (choice: "ours" | "theirs") => void;
  t: Dictionary;
  oursLabel: string;
  theirsLabel: string;
}) {
  const changeBlocks = blocks.filter((b): b is ChangeBlock => b.kind === "change");

  // Group consecutive rows: same rows, then change groups with actions.
  const groups: Array<
    | { kind: "same"; rows: AlignedRow[] }
    | { kind: "change"; changeId: string; rows: AlignedRow[]; block: ChangeBlock }
  > = [];

  for (const row of rows) {
    if (row.changeId === null) {
      const last = groups[groups.length - 1];
      if (last?.kind === "same") last.rows.push(row);
      else groups.push({ kind: "same", rows: [row] });
    } else {
      const last = groups[groups.length - 1];
      if (last?.kind === "change" && last.changeId === row.changeId) {
        last.rows.push(row);
      } else {
        const block = changeBlocks.find((b) => b.id === row.changeId)!;
        groups.push({ kind: "change", changeId: row.changeId, rows: [row], block });
      }
    }
  }

  return (
    <div className="overflow-hidden">
      <div className="border-border/60 grid grid-cols-1 divide-y border-b sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <button
          type="button"
          onClick={() => onAcceptAll("ours")}
          className={cn(
            "flex items-center justify-between gap-2 px-3 py-2.5 text-start",
            "bg-muted/20 hover:bg-rose-500/[0.08] transition-colors duration-200 ease-[var(--ease-out-spring)]",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
              {oursLabel}
            </span>
            <span className="text-muted-foreground block text-[10px] font-medium tracking-wide uppercase">
              {t.mr.acceptAllLeft}
            </span>
          </span>
          <span className="bg-rose-500/12 text-rose-700 dark:text-rose-300 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
            −
          </span>
        </button>
        <button
          type="button"
          onClick={() => onAcceptAll("theirs")}
          className={cn(
            "flex items-center justify-between gap-2 px-3 py-2.5 text-start",
            "bg-muted/20 hover:bg-emerald-500/[0.08] transition-colors duration-200 ease-[var(--ease-out-spring)]",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
              {theirsLabel}
            </span>
            <span className="text-muted-foreground block text-[10px] font-medium tracking-wide uppercase">
              {t.mr.acceptAllRight}
            </span>
          </span>
          <span className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
            +
          </span>
        </button>
      </div>

      <div className="overflow-x-auto">
        {groups.map((group, groupIndex) => {
          if (group.kind === "same") {
            return (
              <div key={`g-${groupIndex}`}>
                {group.rows.map((row, index) => (
                  <div key={index} className="border-border/20 grid grid-cols-1 border-b sm:grid-cols-2">
                    <DiffLine cell={row.left} side="ours" />
                    <div className="border-border/30 border-t sm:border-t-0 sm:border-s">
                      <DiffLine cell={row.right} side="theirs" />
                    </div>
                  </div>
                ))}
              </div>
            );
          }

          const choice = choices[group.changeId];
          return (
            <div
              key={group.changeId}
              className={cn(
                "border-y",
                choice ? "border-emerald-500/20" : "border-amber-500/25",
              )}
            >
              <div className="border-border/40 bg-background/60 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1">
                <span className="text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase">
                  {t.mr.changeLabel(group.block.index + 1)}
                </span>
                <ChangeActions
                  choice={choice}
                  onChoose={(c) => onChoose(group.changeId, c)}
                  t={t}
                  compact
                />
              </div>
              {group.rows.map((row, index) => (
                <div
                  key={index}
                  className="border-border/20 grid grid-cols-1 border-b last:border-b-0 sm:grid-cols-2"
                >
                  <button
                    type="button"
                    onClick={() => onChoose(group.changeId, "ours")}
                    className={cn(
                      "min-w-0 text-start transition-colors duration-200 ease-[var(--ease-out-spring)]",
                      "focus-visible:ring-ring focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
                      choice === "ours" && "bg-rose-500/[0.06]",
                      choice === "theirs" && "opacity-40",
                      !choice && "hover:bg-rose-500/[0.04]",
                    )}
                  >
                    <DiffLine cell={row.left} side="ours" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChoose(group.changeId, "theirs")}
                    className={cn(
                      "border-border/30 min-w-0 border-t text-start transition-colors duration-200 ease-[var(--ease-out-spring)] sm:border-t-0 sm:border-s",
                      "focus-visible:ring-ring focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
                      choice === "theirs" && "bg-emerald-500/[0.06]",
                      choice === "ours" && "opacity-40",
                      !choice && "hover:bg-emerald-500/[0.04]",
                    )}
                  >
                    <DiffLine cell={row.right} side="theirs" />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HunkCard({
  hunk,
  resolution,
  onChange,
  viewMode,
  t,
  bulkAccept,
}: {
  hunk: ReturnType<typeof conflictHunks>[number];
  resolution: HunkResolution | undefined;
  onChange: (resolution: HunkResolution | undefined) => void;
  viewMode: ViewMode;
  t: Dictionary;
  /** When `key` bumps, apply this side to every change in the hunk. */
  bulkAccept: { key: number; choice: "ours" | "theirs" } | null;
}) {
  const [editing, setEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState(resolution?.customText ?? hunk.ours);
  const [choices, setChoices] = useState<Record<string, ChangeChoice>>({});
  const [manualCustom, setManualCustom] = useState(false);
  const isBinary =
    isBinaryConflictToken(hunk.ours) && isBinaryConflictToken(hunk.theirs);

  const blocks = useMemo(
    () => (isBinary ? [] : splitChangeBlocks(hunk.ours, hunk.theirs)),
    [hunk.ours, hunk.theirs, isBinary],
  );
  const changeBlocks = useMemo(
    () => blocks.filter((b): b is ChangeBlock => b.kind === "change"),
    [blocks],
  );
  const rows = useMemo(() => alignSides(blocks), [blocks]);

  const allDecided =
    changeBlocks.length > 0 && changeBlocks.every((block) => choices[block.id] !== undefined);

  function acceptAll(choice: "ours" | "theirs" | "both") {
    setEditing(false);
    setManualCustom(false);
    if (isBinary) {
      if (choice === "both") return;
      onChange({ mode: choice });
      return;
    }
    if (changeBlocks.length === 0) {
      onChange({ mode: choice === "both" ? "ours" : choice });
      return;
    }
    const next: Record<string, ChangeChoice> = {};
    for (const block of changeBlocks) next[block.id] = choice;
    setChoices(next);
  }

  useEffect(() => {
    if (!bulkAccept) return;
    acceptAll(bulkAccept.choice);
    // Only react to bulk key bumps from the file toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkAccept?.key]);

  useEffect(() => {
    if (isBinary || editing || manualCustom) return;
    if (changeBlocks.length === 0) {
      onChange({ mode: "ours" });
      return;
    }
    if (allDecided) {
      const allOurs = changeBlocks.every((b) => choices[b.id] === "ours");
      const allTheirs = changeBlocks.every((b) => choices[b.id] === "theirs");
      const allBoth = changeBlocks.every((b) => choices[b.id] === "both");
      if (allOurs) onChange({ mode: "ours" });
      else if (allTheirs) onChange({ mode: "theirs" });
      else if (allBoth) onChange({ mode: "both" });
      else onChange({ mode: "custom", customText: assembleFromChoices(blocks, choices) });
    } else {
      onChange(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDecided, choices, isBinary, editing, manualCustom]);

  function choose(changeId: string, choice: ChangeChoice) {
    setManualCustom(false);
    setChoices((prev) => ({ ...prev, [changeId]: choice }));
  }

  const isResolved = isBinary
    ? resolution?.mode === "ours" || resolution?.mode === "theirs"
    : manualCustom || allDecided;

  return (
    <section
      className={cn(
        "conflict-hunk overflow-hidden rounded-xl border",
        "transition-[border-color,box-shadow] duration-400 ease-[var(--ease-out-spring)]",
        isResolved ? "border-emerald-500/40" : "border-amber-500/40",
      )}
    >
      <header className="border-border/70 bg-muted/25 flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isResolved ? "bg-emerald-500" : "animate-pulse bg-amber-500",
            )}
          />
          <span className="text-foreground/80 truncate text-[13px] font-medium tracking-[-0.01em]">
            {isBinary ? t.mr.binaryConflictTitle : t.mr.conflictingChange}
          </span>
          {!isBinary && changeBlocks.length > 1 ? (
            <span className="text-muted-foreground hidden text-[11px] sm:inline">
              · {changeBlocks.length}
            </span>
          ) : null}
        </div>
        {isResolved ? (
          <Badge variant="success" className="text-[0.65rem]">
            {t.mr.resolved}
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[0.65rem]">
            {t.mr.needsDecision}
          </Badge>
        )}
      </header>

      {editing && !isBinary ? (
        <div className="flex flex-col gap-3 p-3.5">
          <Textarea
            autoFocus
            rows={7}
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            placeholder={t.mr.writeFinal}
            className="font-mono text-[12.5px] leading-5"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setManualCustom(true);
                onChange({ mode: "custom", customText: customDraft });
                setEditing(false);
              }}
            >
              {t.mr.useThisText}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : isBinary ? (
        <div className="text-muted-foreground grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <button
            type="button"
            onClick={() => onChange({ mode: "ours" })}
            className={cn(
              "flex min-h-28 flex-col items-center justify-center gap-2 px-4 py-8 text-sm transition-colors duration-300 ease-[var(--ease-out-spring)]",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              resolution?.mode === "ours" && "bg-rose-500/[0.08] ring-1 ring-inset ring-rose-500/40",
            )}
          >
            <span className="font-medium text-foreground">{t.mr.binaryKeepPublished}</span>
            <span className="italic">{t.mr.binaryPreview}</span>
          </button>
          <button
            type="button"
            onClick={() => onChange({ mode: "theirs" })}
            className={cn(
              "flex min-h-28 flex-col items-center justify-center gap-2 px-4 py-8 text-sm transition-colors duration-300 ease-[var(--ease-out-spring)]",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              resolution?.mode === "theirs" &&
                "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-500/40",
            )}
          >
            <span className="font-medium text-foreground">{t.mr.binaryUseSuggested}</span>
            <span className="italic">{t.mr.binaryPreview}</span>
          </button>
        </div>
      ) : (
        <>
          {viewMode === "integrated" ? (
            <IntegratedDiff blocks={blocks} choices={choices} onChoose={choose} t={t} />
          ) : (
            <SideBySideDiff
              blocks={blocks}
              rows={rows}
              choices={choices}
              onChoose={choose}
              onAcceptAll={acceptAll}
              t={t}
              oursLabel={t.mr.keepPublished}
              theirsLabel={t.mr.useSuggested}
            />
          )}

          <footer className="border-border/70 bg-muted/15 flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => acceptAll("ours")}
            >
              {t.mr.acceptAllLeft}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => acceptAll("theirs")}
            >
              {t.mr.acceptAllRight}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "h-7 gap-1.5 text-xs",
                allDecided &&
                  changeBlocks.every((b) => choices[b.id] === "both") &&
                  "border-primary bg-primary/5 text-primary",
              )}
              onClick={() => acceptAll("both")}
            >
              <Rows2 className="size-3.5 opacity-70" />
              {t.mr.keepBoth}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                setCustomDraft(
                  allDecided
                    ? assembleFromChoices(blocks, choices)
                    : (resolution?.customText ?? hunk.ours),
                );
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5 opacity-70" />
              {t.mr.writeMyself}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

/**
 * Manager-only conflict resolution: side-by-side or integrated (unified) diff
 * with per-change Accept current / Accept incoming decisions.
 */
export function ConflictResolver({
  markerText,
  onResolvedChange,
}: {
  markerText: string;
  onResolvedChange: (resolvedText: string | null) => void;
}) {
  const { t } = useI18n();
  const segments = useMemo(() => parseConflictMarkers(markerText), [markerText]);
  const hunks = useMemo(() => conflictHunks(segments), [segments]);
  const [resolutions, setResolutions] = useState<Record<string, HunkResolution | undefined>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [bulkAccept, setBulkAccept] = useState<{
    key: number;
    choice: "ours" | "theirs";
  } | null>(null);

  const allResolved = hunks.length > 0 && hunks.every((hunk) => resolutions[hunk.id] !== undefined);

  useEffect(() => {
    const clean: Record<string, HunkResolution> = {};
    for (const [id, value] of Object.entries(resolutions)) {
      if (value) clean[id] = value;
    }
    onResolvedChange(allResolved ? assembleResolvedText(segments, clean) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, resolutions, segments]);

  function acceptAllFromSide(choice: "ours" | "theirs") {
    setBulkAccept((prev) => ({ key: (prev?.key ?? 0) + 1, choice }));
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-rose-500/30 text-xs hover:bg-rose-500/[0.08] active:scale-[0.97]"
            title={t.mr.acceptAllLeftHint}
            onClick={() => acceptAllFromSide("ours")}
          >
            {t.mr.acceptAllLeft}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-emerald-500/30 text-xs hover:bg-emerald-500/[0.08] active:scale-[0.97]"
            title={t.mr.acceptAllRightHint}
            onClick={() => acceptAllFromSide("theirs")}
          >
            {t.mr.acceptAllRight}
          </Button>
        </div>
        <div
          role="group"
          aria-label="Diff view"
          className="bg-muted/40 border-border/60 inline-flex rounded-lg border p-0.5"
        >
          <button
            type="button"
            onClick={() => setViewMode("integrated")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "transition-all duration-200 ease-[var(--ease-out-spring)]",
              viewMode === "integrated"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <AlignLeft className="size-3.5 opacity-70" />
            {t.mr.viewIntegrated}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("side-by-side")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "transition-all duration-200 ease-[var(--ease-out-spring)]",
              viewMode === "side-by-side"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Columns2 className="size-3.5 opacity-70" />
            {t.mr.viewSideBySide}
          </button>
        </div>
      </div>

      {segments.map((segment, index) =>
        segment.kind === "context" ? (
          <ContextBlock key={`context-${index}`} text={segment.text} />
        ) : (
          <HunkCard
            key={segment.id}
            hunk={segment}
            resolution={resolutions[segment.id]}
            onChange={(resolution) =>
              setResolutions((prev) => ({ ...prev, [segment.id]: resolution }))
            }
            viewMode={viewMode}
            t={t}
            bulkAccept={bulkAccept}
          />
        ),
      )}
    </div>
  );
}
