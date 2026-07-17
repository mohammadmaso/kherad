"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { PlusIcon } from "lucide-react";

import { Editor } from "@/components/editor/editor";
import { FrontmatterForm } from "@/components/editor/frontmatter-form";
import { RestoreDraftDialog } from "@/components/editor/restore-draft-dialog";
import { SaveStatus, type SaveStatusValue } from "@/components/editor/save-status";
import { SoftLockBanner } from "@/components/editor/soft-lock-banner";
import {
  fetchAutosaveDraft,
  fetchPageContent,
  fetchPresence,
  saveAutosaveDraft,
  savePageContent,
  sendPresenceHeartbeat,
  setToken,
  submitForReview,
  type PageContent,
  type PresenceEntry,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";
import { serializeOkfFrontmatter, splitFrontmatter, type OkfFrontmatter } from "@/lib/okf-frontmatter";

const AUTOSAVE_INTERVAL_MS = 8_000;
const PRESENCE_INTERVAL_MS = 12_000;

type DraftPrompt = { markdown: string; updatedAt: string } | null;

export default function EditPage() {
  const params = useParams<{ bundleId: string; pageId: string }>();
  const searchParams = useSearchParams();
  const { bundleId, pageId } = params;
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageContent | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<DraftPrompt>(null);
  const [initialMarkdown, setInitialMarkdown] = useState("");
  const [frontmatter, setFrontmatter] = useState<OkfFrontmatter | null>(null);
  const [status, setStatus] = useState<SaveStatusValue>("saved");
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedMrId, setSubmittedMrId] = useState<string | null>(null);

  const markdownRef = useRef("");
  const frontmatterRef = useRef<OkfFrontmatter | null>(null);
  const isDirtyRef = useRef(false);

  function combinedMarkdown(): string {
    return frontmatterRef.current
      ? serializeOkfFrontmatter(frontmatterRef.current) + markdownRef.current
      : markdownRef.current;
  }

  function updateFrontmatter(next: OkfFrontmatter | null) {
    frontmatterRef.current = next;
    setFrontmatter(next);
    isDirtyRef.current = true;
    setStatus((prev) => (prev === "saving" ? prev : "unsaved"));
  }

  // Dev convenience: bootstrap a JWT from ?token= into localStorage (no login UI yet).
  useEffect(() => {
    const token = searchParams.get("token");
    if (token) void setToken(token);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [pageContent, { draft }] = await Promise.all([
          fetchPageContent(bundleId, pageId),
          fetchAutosaveDraft(pageId),
        ]);
        if (cancelled) return;

        setPage(pageContent);

        const draftContent = draft?.contentJson as { markdown?: string } | undefined;
        const draftMarkdown = draftContent?.markdown;
        const draftIsNewer =
          draft &&
          draftMarkdown !== undefined &&
          (!pageContent.lastCommitAt ||
            new Date(draft.updatedAt) > new Date(pageContent.lastCommitAt));

        const split = splitFrontmatter(pageContent.content);
        frontmatterRef.current = split.frontmatter;
        setFrontmatter(split.frontmatter);
        setInitialMarkdown(split.body);
        markdownRef.current = split.body;

        if (draftIsNewer && draftMarkdown !== pageContent.content) {
          setDraftPrompt({ markdown: draftMarkdown, updatedAt: draft.updatedAt });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t.editor.loadFailed);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bundleId, pageId, t.editor.loadFailed]);

  // Autosave: only writes to Postgres, never touches git.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!isDirtyRef.current) return;
      setStatus("autosaving");
      try {
        await saveAutosaveDraft(pageId, { markdown: combinedMarkdown() });
        isDirtyRef.current = false;
        setStatus("autosaved");
      } catch {
        setStatus("unsaved");
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pageId]);

  // Soft-lock presence: heartbeat + poll for other active editors.
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        await sendPresenceHeartbeat(bundleId, pageId);
        const entries = await fetchPresence(bundleId, pageId);
        if (!cancelled) setPresence(entries);
      } catch {
        // presence is best-effort; ignore failures
      }
    }

    tick();
    const interval = setInterval(tick, PRESENCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bundleId, pageId]);

  const handleMarkdownChange = useCallback((markdown: string) => {
    markdownRef.current = markdown;
    isDirtyRef.current = true;
    setStatus((prev) => (prev === "saving" ? prev : "unsaved"));
  }, []);

  async function handleSave() {
    setStatus("saving");
    setActionError(null);
    try {
      const result = await savePageContent(bundleId, pageId, combinedMarkdown());
      isDirtyRef.current = false;
      setStatus("saved");
      setPage((prev) => (prev ? { ...prev, lastCommitAt: result.updatedAt } : prev));
    } catch (err) {
      setStatus("unsaved");
      setActionError(err instanceof Error ? err.message : t.editor.saveFailed);
    }
  }

  async function handleSubmitForReview() {
    setSubmitting(true);
    setActionError(null);
    try {
      // Autosave only writes Postgres drafts — flush to the user branch so the
      // MR (and a later wiki merge) actually includes the latest editor content.
      setStatus("saving");
      const result = await savePageContent(bundleId, pageId, combinedMarkdown());
      isDirtyRef.current = false;
      setStatus("saved");
      setPage((prev) => (prev ? { ...prev, lastCommitAt: result.updatedAt } : prev));

      const mr = await submitForReview(bundleId);
      setSubmittedMrId(mr.id);
    } catch (err) {
      setStatus("unsaved");
      setActionError(err instanceof Error ? err.message : t.editor.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function handleRestoreDraft() {
    if (!draftPrompt) return;
    const split = splitFrontmatter(draftPrompt.markdown);
    frontmatterRef.current = split.frontmatter;
    setFrontmatter(split.frontmatter);
    setInitialMarkdown(split.body);
    markdownRef.current = split.body;
    isDirtyRef.current = true;
    setStatus("unsaved");
    setDraftPrompt(null);
  }

  function handleDiscardDraft() {
    setDraftPrompt(null);
  }

  if (loading) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  if (loadError) {
    return <div className="text-destructive p-8 text-sm">{loadError}</div>;
  }

  if (!page) {
    return null;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="truncate" dir="auto">
          {page.title}
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <SaveStatus status={status} />
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={handleSubmitForReview}
          >
            {submitting ? t.editor.submitting : t.editor.submit}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t.editor.save}
          </Button>
        </div>
      </div>

      {submittedMrId ? (
        <p className="text-muted-foreground text-sm">
          {t.editor.submittedPrefix}{" "}
          <a
            className="text-primary underline underline-offset-2"
            href={`/bundles/${bundleId}/merge-requests/${submittedMrId}`}
          >
            {t.editor.viewMr}
          </a>
        </p>
      ) : null}

      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.editor.actionFailed}</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <SoftLockBanner entries={presence} />

      {draftPrompt ? (
        <RestoreDraftDialog
          open
          draftUpdatedAt={draftPrompt.updatedAt}
          onRestore={handleRestoreDraft}
          onDiscard={handleDiscardDraft}
        />
      ) : null}

      {frontmatter ? (
        <FrontmatterForm
          value={frontmatter}
          onChange={updateFrontmatter}
          resetToken={draftPrompt ? "pending-restore" : "editor"}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-dashed self-start"
          onClick={() => updateFrontmatter({ extra: {} })}
        >
          <PlusIcon className="size-3.5" />
          {t.frontmatter.addFrontmatter}
        </Button>
      )}

      <Editor
        key={draftPrompt ? "pending-restore" : "editor"}
        initialMarkdown={initialMarkdown}
        onMarkdownChange={handleMarkdownChange}
        bundleId={bundleId}
      />
    </div>
  );
}
