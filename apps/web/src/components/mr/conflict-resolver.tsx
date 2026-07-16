"use client";

import { isBinaryConflictToken } from "@kherad/core/binary-conflict";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { useEffect, useMemo, useState } from "react";

import {
  assembleResolvedText,
  conflictHunks,
  parseConflictMarkers,
  type HunkResolution,
} from "@/lib/conflict-diff";
import { useI18n } from "@/lib/i18n/provider";
import type { Dictionary } from "@/lib/i18n/dictionaries";

function ContextBlock({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <p
      className="bg-muted/30 text-muted-foreground whitespace-pre-wrap rounded-md px-3 py-2 text-sm"
      dir="auto"
    >
      {trimmed}
    </p>
  );
}

function ChoiceCard({
  label,
  text,
  selected,
  onSelect,
  emptyLabel,
}: {
  label: string;
  text: string;
  selected: boolean;
  onSelect: () => void;
  emptyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-1.5 rounded-lg border p-3 text-start transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
      }`}
    >
      <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <span
          className={`inline-block size-3 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`}
        />
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm" dir="auto">
        {text.trim() || <em className="text-muted-foreground">{emptyLabel}</em>}
      </span>
    </button>
  );
}

function HunkCard({
  hunk,
  resolution,
  onChange,
  t,
}: {
  hunk: ReturnType<typeof conflictHunks>[number];
  resolution: HunkResolution | undefined;
  onChange: (resolution: HunkResolution) => void;
  t: Dictionary;
}) {
  const [editing, setEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState(resolution?.customText ?? hunk.ours);
  const isBinary =
    isBinaryConflictToken(hunk.ours) && isBinaryConflictToken(hunk.theirs);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          {isBinary ? t.mr.binaryConflictTitle : t.mr.conflictingChange}
        </span>
        {resolution ? (
          <Badge variant="success" className="text-[0.65rem]">
            {t.mr.resolved}
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[0.65rem]">
            {t.mr.needsDecision}
          </Badge>
        )}
      </div>

      {editing && !isBinary ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={5}
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            placeholder={t.mr.writeFinal}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
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
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ChoiceCard
              label={isBinary ? t.mr.binaryKeepPublished : t.mr.keepPublished}
              text={isBinary ? t.mr.binaryPreview : hunk.ours}
              selected={resolution?.mode === "ours"}
              onSelect={() => onChange({ mode: "ours" })}
              emptyLabel={t.mr.emptyPreview}
            />
            <ChoiceCard
              label={isBinary ? t.mr.binaryUseSuggested : t.mr.useSuggested}
              text={isBinary ? t.mr.binaryPreview : hunk.theirs}
              selected={resolution?.mode === "theirs"}
              onSelect={() => onChange({ mode: "theirs" })}
              emptyLabel={t.mr.emptyPreview}
            />
          </div>
          {!isBinary ? (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className={resolution?.mode === "both" ? "border-primary text-primary" : undefined}
                onClick={() => onChange({ mode: "both" })}
              >
                {t.mr.keepBoth}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCustomDraft(resolution?.customText ?? hunk.ours);
                  setEditing(true);
                }}
              >
                {t.mr.writeMyself}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Manager-only conflict resolution, redesigned around picking a version per
 * conflicting section (JetBrains-style "yours/theirs/result") instead of
 * hand-editing raw `<<<<<<<`/`=======`/`>>>>>>>` git markers — the previous
 * Monaco-based editor assumed git literacy this audience doesn't have.
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
  const [resolutions, setResolutions] = useState<Record<string, HunkResolution>>({});

  const allResolved = hunks.length > 0 && hunks.every((hunk) => resolutions[hunk.id] !== undefined);

  useEffect(() => {
    onResolvedChange(allResolved ? assembleResolvedText(segments, resolutions) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, resolutions, segments]);

  return (
    <div className="flex flex-col gap-3 p-3">
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
            t={t}
          />
        ),
      )}
    </div>
  );
}
