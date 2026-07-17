"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConflictResolver } from "@/components/mr/conflict-resolver";
import {
  fetchMrConflicts,
  resolveMrConflict,
  type MergeRequestSummary,
  type MrConflictFile,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Manager-only screen (PRD §3): shown when an approve attempt hits a real
 * merge conflict. For each conflicting section, the manager picks "keep the
 * current version", "use the suggested edit", "keep both", or writes it
 * themselves — no git markers or branch names shown — then commits the
 * resolution and completes the squash-merge. Never reachable by authors —
 * the API 403s anyone without bundle-level review permission.
 */
export default function ResolveConflictPage() {
  const { bundleId, mrId } = useParams<{ bundleId: string; mrId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [mr, setMr] = useState<MergeRequestSummary | null>(null);
  const [conflicts, setConflicts] = useState<MrConflictFile[] | null>(null);
  // Per-path resolved file content — null until every conflicting section in
  // that file has a decision.
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchMrConflicts(bundleId, mrId)
      .then(({ mr: mrRow, conflicts: files }) => {
        if (cancelled) return;
        setMr(mrRow);
        setConflicts(files);
        setResolved(Object.fromEntries(files.map((f) => [f.path, null])));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.mr.loadConflictFailed;
        if (message.includes("Forbidden")) setForbidden(true);
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [bundleId, mrId, t.mr.loadConflictFailed]);

  const unresolvedPaths = useMemo(
    () =>
      Object.entries(resolved)
        .filter(([, text]) => text === null)
        .map(([path]) => path),
    [resolved],
  );

  const handleResolvedChange = useCallback((path: string, text: string | null) => {
    setResolved((prev) => ({ ...prev, [path]: text }));
  }, []);

  async function handleCompleteMerge() {
    if (!conflicts || unresolvedPaths.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await resolveMrConflict(
        bundleId,
        mrId,
        conflicts.map((c) => ({ path: c.path, content: resolved[c.path]! })),
      );
      router.push("/admin/merge-requests");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.mr.completeMergeFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.mr.managersOnly}</AlertTitle>
          <AlertDescription>{t.mr.conflictRestricted}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error && !conflicts) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.mr.loadConflictTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!mr || !conflicts) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => router.push(`/bundles/${bundleId}/merge-requests/${mrId}`)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors duration-200 ease-[var(--ease-out-spring)]"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t.mr.backToMr}
          </button>
          <h1 className="mt-1.5 text-xl font-semibold tracking-[-0.02em]">{t.mr.resolveHeading}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            <span dir="auto">{mr.author.displayName}</span>{" "}
            <span className="text-xs" dir="ltr">
              ({mr.author.email})
            </span>
          </p>
        </div>
        <Button
          className="shrink-0 self-start"
          disabled={submitting || unresolvedPaths.length > 0}
          onClick={handleCompleteMerge}
          title={unresolvedPaths.length > 0 ? t.mr.resolveAllTitle : undefined}
        >
          {submitting ? t.mr.merging : t.mr.completeMerge}
        </Button>
      </div>

      <Alert variant="warning">
        <AlertTitle>{t.mr.someoneChangedTitle}</AlertTitle>
        <AlertDescription>{t.mr.someoneChangedBody}</AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.mr.actionFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-5">
        {conflicts.map((file) => {
          const isResolved = resolved[file.path] !== null;
          const displayName = file.path
            .replace(/^wiki\/[^/]+\//, "")
            .replace(/^raw\/[^/]+\//, "")
            .replace(/^okf\/[^/]+\//, "")
            .replace(/\.md$/, "");
          return (
            <div
              key={file.path}
              className="border-border/80 bg-card/40 overflow-hidden rounded-2xl border"
            >
              <div className="border-border/70 bg-muted/30 flex items-center gap-2.5 border-b px-4 py-2.5">
                <span className="text-foreground/90 truncate text-sm font-medium tracking-[-0.01em]">
                  {displayName}
                </span>
                <Badge variant={isResolved ? "success" : "warning"} className="text-[0.65rem]">
                  {isResolved ? t.mr.resolved : t.mr.unresolved}
                </Badge>
              </div>
              <ConflictResolver
                markerText={file.markerText}
                onResolvedChange={(text) => handleResolvedChange(file.path, text)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
