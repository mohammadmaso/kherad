"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { PlusIcon } from "lucide-react";

import { Editor } from "@/components/editor/editor";
import { FrontmatterForm } from "@/components/editor/frontmatter-form";
import { SaveStatus, type SaveStatusValue } from "@/components/editor/save-status";
import {
  fetchOkfDocContent,
  saveOkfDocContent,
  setToken,
  submitForReview,
} from "@/lib/api-client";
import { decodePathSegments } from "@/lib/decode-path-segments";
import { useI18n } from "@/lib/i18n/provider";
import { serializeOkfFrontmatter, splitFrontmatter, type OkfFrontmatter } from "@/lib/okf-frontmatter";

export default function EditOkfDocPage() {
  const params = useParams<{ bundleId: string; path: string[] }>();
  const searchParams = useSearchParams();
  const { bundleId } = params;
  const sitePath = decodePathSegments(params.path).join("/");
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [frontmatter, setFrontmatter] = useState<OkfFrontmatter | null>(null);
  const [initialBody, setInitialBody] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatusValue>("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedMrId, setSubmittedMrId] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) void setToken(token);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const doc = await fetchOkfDocContent(bundleId, sitePath);
        if (cancelled) return;
        const split = splitFrontmatter(doc.content);
        setFrontmatter(split.frontmatter);
        setInitialBody(split.body);
        setBody(split.body);
        setCanEdit(doc.canEdit);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t.okfDocs.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, sitePath]);

  function combinedMarkdown(): string {
    return frontmatter ? serializeOkfFrontmatter(frontmatter) + body : body;
  }

  async function handleSave() {
    setStatus("saving");
    setActionError(null);
    try {
      await saveOkfDocContent(bundleId, sitePath, combinedMarkdown());
      setStatus("saved");
    } catch (err) {
      setStatus("unsaved");
      setActionError(err instanceof Error ? err.message : t.okfDocs.saveFailed);
    }
  }

  async function handleSubmitForReview() {
    setSubmitting(true);
    setActionError(null);
    try {
      setStatus("saving");
      await saveOkfDocContent(bundleId, sitePath, combinedMarkdown());
      setStatus("saved");

      const mr = await submitForReview(bundleId, "okf");
      setSubmittedMrId(mr.id);
    } catch (err) {
      setStatus("unsaved");
      setActionError(err instanceof Error ? err.message : t.okfDocs.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  if (loadError) {
    return <div className="text-destructive p-8 text-sm">{loadError}</div>;
  }

  const fallbackTitle = sitePath.split("/").pop() ?? sitePath;
  const title = frontmatter?.title || fallbackTitle;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <div className="border-border flex flex-wrap items-start justify-between gap-3 border-b pb-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate" dir="auto">
            {title}
          </h1>
          <span className="text-muted-foreground truncate font-mono text-xs" dir="ltr">
            /{sitePath}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveStatus status={status} />
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit || submitting}
            onClick={handleSubmitForReview}
          >
            {submitting ? t.editor.submitting : t.editor.submit}
          </Button>
          <Button type="button" disabled={!canEdit} onClick={handleSave}>
            {t.editor.save}
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <Alert>
          <AlertTitle>{t.okfDocs.readonly}</AlertTitle>
        </Alert>
      ) : null}

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

      {frontmatter ? (
        <FrontmatterForm value={frontmatter} onChange={setFrontmatter} />
      ) : canEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-dashed self-start"
          onClick={() => setFrontmatter({ extra: {} })}
        >
          <PlusIcon className="size-3.5" />
          {t.frontmatter.addFrontmatter}
        </Button>
      ) : null}

      <Editor
        key={initialBody}
        initialMarkdown={initialBody}
        onMarkdownChange={setBody}
        bundleId={bundleId}
      />
    </div>
  );
}
