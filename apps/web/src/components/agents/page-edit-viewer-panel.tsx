"use client";

import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { cn } from "@kherad/ui/lib/utils";
import { EyeIcon, FileTextIcon, PencilIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SectionEditProposalCard } from "@/components/agents/section-edit-proposal-card";
import { SelectionQuoteToolbar } from "@/components/agents/selection-quote-toolbar";
import { Response } from "@/components/ai-elements/response";
import { Editor } from "@/components/editor/editor";
import { WikiContent } from "@/components/wiki/wiki-content";
import type { TextQuote } from "@/components/chat/text-quotes";
import {
  saveAgentPageEdit,
  submitForReview,
  type AgentPageSection,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

type ViewMode = "preview" | "edit";

type EditModeProps = {
  mode?: "edit";
  sessionId: string;
  bundleId: string | null;
  title?: string | null;
  sections: AgentPageSection[];
  effectiveMarkdown: string;
  onSaved?: () => void;
  onAddQuote?: (quote: TextQuote) => void;
};

type CreateModeProps = {
  mode: "create";
  title?: string | null;
  draftMarkdown: string;
  /** Bump when the draft is replaced externally (e.g. propose_document). */
  editorResetKey?: number;
  bundleId?: string | null;
  onDraftChange: (markdown: string) => void;
  onImport: () => void;
  onAddQuote?: (quote: TextQuote) => void;
};

export type AgentDocumentPanelProps = EditModeProps | CreateModeProps;

/**
 * Shared document column for create- and edit-mode agent sessions:
 * Preview / Edit (Lexical) with the same chrome.
 */
export function PageEditViewerPanel(props: AgentDocumentPanelProps) {
  const isCreate = props.mode === "create";
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Edit mode: null = follow server markdown. Create mode unused. */
  const [manualMarkdown, setManualMarkdown] = useState<string | null>(null);

  const sections = isCreate ? [] : props.sections;
  const serverMarkdown = isCreate ? props.draftMarkdown : props.effectiveMarkdown;
  const workingMarkdown = isCreate
    ? props.draftMarkdown
    : (manualMarkdown ?? props.effectiveMarkdown);
  const dirty = isCreate ? false : manualMarkdown !== null;
  const bundleId = isCreate ? (props.bundleId ?? null) : props.bundleId;
  const title = props.title;
  const onAddQuote = props.onAddQuote;

  const documentRevision = useMemo(
    () =>
      sections.map((s) => `${s.id}:${s.status}:${s.editId ?? ""}`).join("|") +
      `::${serverMarkdown.length}`,
    [sections, serverMarkdown],
  );

  // Drop a spurious empty manual draft (Lexical often fires onChange("") on mount)
  // once the server document is available again after accept/reload.
  useEffect(() => {
    if (isCreate) return;
    if (manualMarkdown !== null && !manualMarkdown.trim() && serverMarkdown.trim()) {
      setManualMarkdown(null);
    }
  }, [isCreate, manualMarkdown, serverMarkdown]);

  const acceptedCount = sections.filter((s) => s.status === "accepted").length;
  const pendingCount = sections.filter((s) => s.status === "proposed").length;
  // Prefer the in-editor draft, but never block save on a cleared Lexical onChange
  // when accepted section edits (or server markdown) are ready to write.
  const saveMarkdown =
    workingMarkdown.trim().length > 0
      ? workingMarkdown
      : !isCreate
        ? props.effectiveMarkdown
        : "";
  const canSaveEdit =
    !isCreate &&
    Boolean(bundleId) &&
    (dirty || acceptedCount > 0) &&
    saveMarkdown.trim().length > 0;

  async function handleSaveAndSubmit() {
    if (isCreate || !bundleId || !canSaveEdit || saving) return;
    setSaving(true);
    setError(null);
    setSuccessNote(null);
    try {
      await saveAgentPageEdit(props.sessionId, saveMarkdown);
      const mr = await submitForReview(bundleId);
      setSuccessNote(t.agents.editSaveSuccess(mr.branchName, props.title));
      setManualMarkdown(null);
      props.onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
    } finally {
      setSaving(false);
    }
  }

  const panelTitle = isCreate ? t.agents.draftTitle : t.agents.editViewerTitle;
  const emptyPreview = isCreate ? t.agents.draftEmpty : t.agents.editNoHeadings;

  return (
    <div className="border-border bg-background/60 flex min-h-0 flex-col overflow-hidden rounded-2xl border shadow-sm backdrop-blur-md">
      <div className="border-border/80 bg-background/70 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 backdrop-blur-md">
        <div className="min-w-0">
          <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-[0.04em] uppercase">
            <FileTextIcon className="size-3.5" />
            {panelTitle}
          </span>
          {title ? (
            <p className="mt-0.5 truncate text-sm font-semibold tracking-[-0.015em]" dir="auto">
              {title}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="border-border bg-muted/40 inline-flex rounded-lg border p-0.5"
            role="tablist"
            aria-label={t.agents.editViewModeLabel}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "preview"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,transform] duration-150 ease-out-spring active:scale-[0.97]",
                viewMode === "preview"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setViewMode("preview")}
            >
              <EyeIcon className="size-3.5" />
              {t.agents.editModePreview}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "edit"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,transform] duration-150 ease-out-spring active:scale-[0.97]",
                viewMode === "edit"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setViewMode("edit")}
            >
              <PencilIcon className="size-3.5" />
              {t.agents.editModeEdit}
              {dirty ? (
                <span className="bg-primary size-1.5 rounded-full" aria-hidden />
              ) : null}
            </button>
          </div>

          {isCreate ? (
            <Button
              size="sm"
              disabled={!workingMarkdown.trim()}
              onClick={() => props.onImport()}
              className="active:scale-[0.97]"
            >
              {t.agents.importButton}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!canSaveEdit || saving}
              onClick={() => void handleSaveAndSubmit()}
              className="shrink-0 active:scale-[0.97]"
            >
              {saving ? t.common.saving : t.agents.editSaveSubmit}
            </Button>
          )}
        </div>
      </div>

      {viewMode === "preview" &&
      !isCreate &&
      (pendingCount > 0 || acceptedCount > 0) &&
      !successNote &&
      !error ? (
        <p className="text-muted-foreground border-border/60 border-b px-4 py-2 text-xs">
          {pendingCount > 0
            ? t.agents.editPendingHint(pendingCount)
            : t.agents.editAcceptedHint(acceptedCount)}
        </p>
      ) : null}

      {viewMode === "preview" && onAddQuote ? (
        <p className="text-muted-foreground border-border/60 border-b px-4 py-1.5 text-[0.6875rem]">
          {t.agents.quoteSelectHint}
        </p>
      ) : null}

      {viewMode === "edit" ? (
        <p className="text-muted-foreground border-border/60 border-b px-4 py-1.5 text-[0.6875rem]">
          {t.agents.editManualHint}
        </p>
      ) : null}

      {successNote ? (
        <p className="border-border/60 border-b px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {successNote}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive border-border/60 border-b px-4 py-2 text-xs">{error}</p>
      ) : null}

      {viewMode === "edit" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          <Editor
            key={
              isCreate
                ? `create-${props.editorResetKey ?? 0}`
                : manualMarkdown === null
                  ? documentRevision
                  : "manual"
            }
            className="min-h-0 flex-1"
            initialMarkdown={workingMarkdown}
            bundleId={bundleId ?? undefined}
            contentClassName="min-h-[280px] px-4 py-3 text-sm outline-none"
            onMarkdownChange={(md) => {
              if (isCreate) {
                props.onDraftChange(md);
                return;
              }
              // Lexical can emit an empty onChange during mount/remount; ignore it
              // so we don't wipe the document and disable Save & submit.
              if (!md.trim() && props.effectiveMarkdown.trim()) return;
              setManualMarkdown(md === props.effectiveMarkdown ? null : md);
            }}
          />
        </div>
      ) : (
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {onAddQuote ? (
            <SelectionQuoteToolbar containerRef={scrollRef} onAddQuote={onAddQuote} />
          ) : null}

          {isCreate ? (
            workingMarkdown.trim() ? (
              <article
                data-section-heading={title ?? undefined}
                className="wiki-content mx-auto w-full max-w-2xl px-8 py-10 sm:px-12 sm:py-12"
              >
                <Response>{workingMarkdown}</Response>
              </article>
            ) : (
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-8 py-16 text-center">
                <p className="text-muted-foreground text-sm leading-relaxed">{emptyPreview}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewMode("edit")}
                  className="active:scale-[0.97]"
                >
                  <PencilIcon className="size-3.5" />
                  {t.agents.editUseEditorHint}
                </Button>
              </div>
            )
          ) : sections.length === 0 ? (
            <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-8 py-16 text-center">
              <p className="text-muted-foreground text-sm leading-relaxed">{emptyPreview}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewMode("edit")}
                className="active:scale-[0.97]"
              >
                <PencilIcon className="size-3.5" />
                {t.agents.editUseEditorHint}
              </Button>
            </div>
          ) : (
            <article className="mx-auto w-full max-w-2xl px-8 py-10 sm:px-12 sm:py-12">
              {sections.map((section, index) => {
                const edited = section.status === "accepted";
                const pending = section.status === "proposed";
                const showDiff =
                  expandedId === section.id &&
                  Boolean(section.baseHtml && section.proposedHtml) &&
                  (edited || pending);

                return (
                  <section
                    key={section.id}
                    data-section-id={section.id}
                    data-section-heading={section.headingText}
                    className={index > 0 ? "border-border/50 mt-10 border-t pt-10" : undefined}
                  >
                    {(edited || pending) && (
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        {edited ? (
                          <Badge variant="success">{t.agents.sectionEditedBadge}</Badge>
                        ) : null}
                        {pending ? (
                          <Badge variant="warning">{t.agents.sectionStatusProposed}</Badge>
                        ) : null}
                        <button
                          type="button"
                          className="text-primary text-xs font-medium tracking-[-0.01em] transition-opacity duration-150 hover:opacity-80 active:scale-[0.98]"
                          onClick={() =>
                            setExpandedId((prev) => (prev === section.id ? null : section.id))
                          }
                        >
                          {showDiff ? t.agents.sectionHideDiff : t.agents.sectionShowDiff}
                        </button>
                      </div>
                    )}

                    {showDiff && section.baseHtml && section.proposedHtml && section.editId ? (
                      <SectionEditProposalCard
                        sessionId={props.sessionId}
                        readOnly
                        variant="diff"
                        proposal={{
                          editId: section.editId,
                          sectionId: section.id,
                          headingText: section.headingText,
                          baseHtml: section.baseHtml,
                          proposedHtml: section.proposedHtml,
                          status:
                            section.status === "accepted" ||
                            section.status === "proposed" ||
                            section.status === "rejected" ||
                            section.status === "superseded"
                              ? section.status
                              : "accepted",
                        }}
                      />
                    ) : (
                      <WikiContent html={section.html} />
                    )}
                  </section>
                );
              })}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
