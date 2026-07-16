"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { useState } from "react";

import type { MrComment } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function CommentItem({ comment, locale }: { comment: MrComment; locale: string }) {
  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium" dir="auto">
          {comment.author.displayName}
        </span>
        <span className="text-muted-foreground text-xs">
          {new Date(comment.createdAt).toLocaleString(locale === "fa" ? "fa-IR" : undefined)}
        </span>
      </div>
      {comment.path ? (
        <div className="text-muted-foreground mb-1 font-mono text-xs" dir="ltr">
          {comment.path}
          {comment.line !== null ? `:${comment.line}` : ""}
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-sm" dir="auto">
        {comment.body}
      </p>
    </div>
  );
}

/** Inline comments anchored to a path/line, plus general MR-level discussion. */
export function CommentThread({
  comments,
  onAddComment,
}: {
  comments: MrComment[];
  onAddComment: (body: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await onAddComment(draft.trim());
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.mr.noComments}</p>
      ) : (
        comments.map((comment) => (
          <CommentItem key={comment.id} comment={comment} locale={locale} />
        ))
      )}

      <div className="border-border flex flex-col gap-2 border-t pt-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.mr.leaveComment}
          rows={3}
        />
        <Button
          size="sm"
          className="self-end"
          disabled={submitting || !draft.trim()}
          onClick={handleSubmit}
        >
          {t.mr.comment}
        </Button>
      </div>
    </div>
  );
}
