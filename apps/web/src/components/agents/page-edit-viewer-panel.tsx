"use client";

import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { FileTextIcon } from "lucide-react";
import { useState } from "react";

import { SectionEditProposalCard } from "@/components/agents/section-edit-proposal-card";
import { WikiContent } from "@/components/wiki/wiki-content";
import {
  saveAgentPageEdit,
  submitForReview,
  type AgentPageSection,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Document viewer for edit-mode sessions: rendered section HTML (not raw
 * markdown), with edited badges and save → submit for review.
 */
export function PageEditViewerPanel({
  sessionId,
  bundleId,
  sections,
  onSaved,
}: {
  sessionId: string;
  bundleId: string | null;
  sections: AgentPageSection[];
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const acceptedCount = sections.filter((s) => s.status === "accepted").length;
  const canSave = acceptedCount > 0 && Boolean(bundleId);

  async function handleSaveAndSubmit() {
    if (!bundleId || !canSave || saving) return;
    setSaving(true);
    setError(null);
    setSuccessNote(null);
    try {
      await saveAgentPageEdit(sessionId);
      const mr = await submitForReview(bundleId);
      setSuccessNote(t.agents.editSaveSuccess(mr.branchName));
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-border flex min-h-0 flex-col overflow-hidden rounded-2xl border">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <FileTextIcon className="size-4" />
          {t.agents.editViewerTitle}
        </span>
        <Button
          size="sm"
          disabled={!canSave || saving}
          onClick={() => void handleSaveAndSubmit()}
          className="active:scale-[0.97]"
        >
          {saving ? t.common.saving : t.agents.editSaveSubmit}
        </Button>
      </div>

      {successNote ? (
        <p className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs">
          {successNote}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive border-border border-b px-3 py-1.5 text-xs">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {sections.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {t.agents.editNoHeadings}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => {
              const edited = section.status === "accepted";
              const showDiff =
                expandedId === section.id &&
                section.baseHtml &&
                section.proposedHtml &&
                (section.status === "accepted" || section.status === "proposed");

              return (
                <section key={section.id} className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {edited ? (
                      <Badge variant="secondary">{t.agents.sectionEditedBadge}</Badge>
                    ) : null}
                    {section.status === "proposed" ? (
                      <Badge variant="warning">{t.agents.sectionStatusProposed}</Badge>
                    ) : null}
                    {edited || section.status === "proposed" ? (
                      <button
                        type="button"
                        className="text-primary text-xs hover:underline"
                        onClick={() =>
                          setExpandedId((prev) => (prev === section.id ? null : section.id))
                        }
                      >
                        {showDiff ? t.agents.sectionHideDiff : t.agents.sectionShowDiff}
                      </button>
                    ) : null}
                  </div>

                  {showDiff && section.baseHtml && section.proposedHtml && section.editId ? (
                    <SectionEditProposalCard
                      sessionId={sessionId}
                      readOnly
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
                    <div className="prose-wiki">
                      <WikiContent html={section.html} />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
