"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CommentThread } from "@/components/mr/comment-thread";
import { DiffView } from "@/components/mr/diff-view";
import { ImageDiff } from "@/components/mr/image-diff";
import {
  addMrComment,
  approveMergeRequest,
  fetchMergeRequest,
  fetchMrComments,
  rejectMergeRequest,
  type MergeRequestDetail,
  type MergeRequestStatus,
  type MrComment,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  open: "default",
  conflict: "warning",
  draft: "secondary",
  merged: "success",
  rejected: "outline",
};

export default function MergeRequestDetailPage() {
  const { bundleId, mrId } = useParams<{ bundleId: string; mrId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [mr, setMr] = useState<MergeRequestDetail | null>(null);
  const [comments, setComments] = useState<MrComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [lineCommentTarget, setLineCommentTarget] = useState<{ path: string; line: number } | null>(
    null,
  );
  const [lineCommentBody, setLineCommentBody] = useState("");

  const statusLabel: Record<MergeRequestStatus, string> = {
    open: t.mr.statusOpen,
    conflict: t.mr.statusConflict,
    draft: t.mr.statusDraft,
    merged: t.mr.statusMerged,
    rejected: t.mr.statusRejected,
  };

  const load = useCallback(async () => {
    const [mrDetail, commentRows] = await Promise.all([
      fetchMergeRequest(bundleId, mrId),
      fetchMrComments(bundleId, mrId),
    ]);
    setMr(mrDetail);
    setComments(commentRows);
  }, [bundleId, mrId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.mr.loadDetailFailed);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load, t.mr.loadDetailFailed]);

  async function handleApprove() {
    setActionPending(true);
    setError(null);
    try {
      await approveMergeRequest(bundleId, mrId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.mr.approveFailed);
      // The approve attempt may have failed with a real merge conflict, in
      // which case the server already flipped this MR to 'conflict' even
      // though the HTTP call itself errored — reload to pick that up so the
      // "Resolve conflict" action below appears.
      await load().catch(() => undefined);
    } finally {
      setActionPending(false);
    }
  }

  async function handleReject() {
    setActionPending(true);
    setError(null);
    try {
      await rejectMergeRequest(bundleId, mrId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.mr.rejectFailed);
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddGeneralComment(body: string) {
    await addMrComment(bundleId, mrId, body);
    const rows = await fetchMrComments(bundleId, mrId);
    setComments(rows);
  }

  async function handleAddLineComment() {
    if (!lineCommentTarget || !lineCommentBody.trim()) return;
    await addMrComment(
      bundleId,
      mrId,
      lineCommentBody.trim(),
      lineCommentTarget.path,
      lineCommentTarget.line,
    );
    const rows = await fetchMrComments(bundleId, mrId);
    setComments(rows);
    setLineCommentTarget(null);
    setLineCommentBody("");
  }

  if (error && !mr) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.mr.loadDetailTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!mr) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  const canAct = mr.status === "open";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.push(`/bundles/${bundleId}/merge-requests`)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t.mr.backAll}
          </button>
          <h1 className="mt-1 text-lg font-semibold" dir="auto">
            {mr.author.displayName}
          </h1>
          <p className="text-muted-foreground text-sm" dir="ltr">
            {mr.author.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[mr.status] ?? "outline"}>
            {statusLabel[mr.status] ?? mr.status}
          </Badge>
          {mr.scope === "okf" ? <Badge variant="secondary">{t.mr.aiCompiled}</Badge> : null}
          {mr.status === "conflict" ? (
            <Button
              size="sm"
              onClick={() =>
                router.push(`/bundles/${bundleId}/merge-requests/${mrId}/resolve-conflict`)
              }
            >
              {t.mr.resolveConflict}
            </Button>
          ) : (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={!canAct || actionPending}
                onClick={handleReject}
              >
                {t.mr.reject}
              </Button>
              <Button size="sm" disabled={!canAct || actionPending} onClick={handleApprove}>
                {t.mr.approve}
              </Button>
            </>
          )}
        </div>
      </div>

      {mr.status === "conflict" ? (
        <Alert variant="warning">
          <AlertTitle>{t.mr.conflictWarningTitle}</AlertTitle>
          <AlertDescription>{t.mr.conflictWarningBody}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.mr.actionFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {mr.reviewers.length > 0 ? (
        <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
          {mr.reviewers.map((reviewer) => (
            <span key={reviewer.id}>
              {reviewer.user.displayName}: {reviewer.decision}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-sm font-semibold">
          {t.mr.changedFiles(mr.files.length)}
        </h2>
        {mr.files.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.mr.noChanges}</p>
        ) : (
          mr.files.map((file) => (
            <div key={file.path} className="border-border overflow-hidden rounded-lg border">
              <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
                <span className="font-mono">{file.path}</span>
                <Badge variant="outline" className="text-[0.65rem]">
                  {file.status}
                </Badge>
              </div>
              {file.kind === "asset" ? (
                <ImageDiff beforeUrl={file.beforeUrl} afterUrl={file.afterUrl} />
              ) : (
                <DiffView
                  path={file.path}
                  before={file.before}
                  after={file.after}
                  onCommentOnLine={(path, line) => setLineCommentTarget({ path, line })}
                />
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-semibold">{t.mr.comments}</h2>
        <CommentThread comments={comments ?? []} onAddComment={handleAddGeneralComment} />
      </div>

      <Dialog
        open={lineCommentTarget !== null}
        onOpenChange={(open) => !open && setLineCommentTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lineCommentTarget
                ? t.mr.commentOnLine(lineCommentTarget.path, lineCommentTarget.line)
                : null}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={4}
            value={lineCommentBody}
            onChange={(event) => setLineCommentBody(event.target.value)}
            placeholder={t.mr.commentPlaceholder}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineCommentTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button disabled={!lineCommentBody.trim()} onClick={handleAddLineComment}>
              {t.mr.comment}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
