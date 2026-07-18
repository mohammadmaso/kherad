"use client";

import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { diffLines } from "diff";
import { useMemo, useState } from "react";

import { WikiContent } from "@/components/wiki/wiki-content";
import { decideSectionEdit } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export type SectionEditProposal = {
  editId: string;
  sectionId: string;
  headingText: string;
  baseHtml: string;
  proposedHtml: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
};

/**
 * Before/after rendered HTML for a propose_section_edit tool result.
 * Accept/Reject persist via REST; never touches markdown.
 */
export function SectionEditProposalCard({
  sessionId,
  proposal,
  readOnly = false,
  onDecided,
}: {
  sessionId: string;
  proposal: SectionEditProposal;
  /** History / viewer mode — hide action buttons. */
  readOnly?: boolean;
  onDecided?: (status: "accepted" | "rejected") => void;
}) {
  const { t } = useI18n();
  const [localStatus, setLocalStatus] = useState<SectionEditProposal["status"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefer a decided status from the parent (after reload); otherwise local
  // optimistic status, else the proposal payload default ("proposed").
  const status =
    proposal.status !== "proposed" ? proposal.status : (localStatus ?? proposal.status);

  const linesChanged = useMemo(() => {
    const parts = diffLines(
      stripTags(proposal.baseHtml),
      stripTags(proposal.proposedHtml),
    );
    let added = 0;
    let removed = 0;
    for (const part of parts) {
      const n = part.count ?? part.value.split("\n").length - 1;
      if (part.added) added += n;
      if (part.removed) removed += n;
    }
    return added + removed;
  }, [proposal.baseHtml, proposal.proposedHtml]);

  async function decide(decision: "accept" | "reject") {
    if (busy || status !== "proposed" || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await decideSectionEdit(sessionId, proposal.editId, decision);
      const next = decision === "accept" ? "accepted" : "rejected";
      setLocalStatus(next);
      onDecided?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.agents.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  const decided = status !== "proposed";

  return (
    <div className="border-border bg-muted/30 my-2 overflow-hidden rounded-xl border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" dir="auto">
            {proposal.headingText || proposal.sectionId}
          </p>
          <p className="text-muted-foreground text-xs">
            {t.agents.sectionLinesChanged(linesChanged)}
          </p>
        </div>
        <Badge variant="secondary">
          {status === "proposed"
            ? t.agents.sectionStatusProposed
            : status === "accepted"
              ? t.agents.sectionStatusAccepted
              : status === "rejected"
                ? t.agents.sectionStatusRejected
                : t.agents.sectionStatusSuperseded}
        </Badge>
      </div>

      <div className="grid gap-0 sm:grid-cols-2">
        <div className="border-border border-b p-3 sm:border-e sm:border-b-0">
          <p className="text-muted-foreground mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
            {t.agents.sectionBefore}
          </p>
          <div className="prose-wiki text-muted-foreground opacity-80">
            <WikiContent html={proposal.baseHtml} />
          </div>
        </div>
        <div className="border-primary/30 bg-primary/5 p-3">
          <p className="text-muted-foreground mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
            {t.agents.sectionAfter}
          </p>
          <div className="prose-wiki">
            <WikiContent html={proposal.proposedHtml} />
          </div>
        </div>
      </div>

      {!readOnly ? (
        <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          <Button
            size="sm"
            disabled={busy || decided}
            onClick={() => void decide("accept")}
            className="active:scale-[0.97]"
          >
            {t.agents.sectionAccept}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || decided}
            onClick={() => void decide("reject")}
            className="active:scale-[0.97]"
          >
            {t.agents.sectionReject}
          </Button>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Pull propose_section_edit payloads from AI SDK / Mastra message parts. */
export function extractSectionEditProposals(parts: unknown[]): SectionEditProposal[] {
  const out: SectionEditProposal[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    const toolName =
      typeof p.toolName === "string"
        ? p.toolName
        : type.startsWith("tool-")
          ? type.slice("tool-".length)
          : null;
    if (toolName !== "propose_section_edit") continue;

    const output = (p.output ?? p.result) as Record<string, unknown> | undefined;
    if (!output || typeof output !== "object") continue;
    if (output.status !== "awaiting_review") continue;
    if (typeof output.editId !== "string") continue;
    if (typeof output.baseHtml !== "string" || typeof output.proposedHtml !== "string") continue;

    out.push({
      editId: output.editId,
      sectionId: typeof output.sectionId === "string" ? output.sectionId : "",
      headingText: typeof output.headingText === "string" ? output.headingText : "",
      baseHtml: output.baseHtml,
      proposedHtml: output.proposedHtml,
      status: "proposed",
    });
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "\n").trim();
}
