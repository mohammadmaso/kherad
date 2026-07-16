"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  compileBundle,
  fetchCompileRun,
  fetchCompileRuns,
  type IndexerRun,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const POLL_MS = 2500;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusVariant(
  status: IndexerRun["status"],
): "default" | "secondary" | "outline" | "success" | "warning" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "warning";
  return "secondary";
}

/**
 * Manager surface for kicking off the indexer agent and watching its run.
 * Only meaningful when the bundle is in `llm_compiled` mode — the host page
 * should gate visibility; this component assumes that.
 */
export function CompilePanel({ bundleId }: { bundleId: string }) {
  const { t } = useI18n();
  const [runs, setRuns] = useState<IndexerRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const rows = await fetchCompileRuns(bundleId);
    setRuns(rows);
    const running = rows.find((r) => r.status === "running");
    setActiveRunId(running?.id ?? null);
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRuns();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load runs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRuns]);

  // Poll while a run is in flight so the UI flips to success/error without a refresh.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const run = await fetchCompileRun(bundleId, activeRunId);
        if (cancelled) return;
        setRuns((prev) => {
          if (!prev) return [run];
          const without = prev.filter((r) => r.id !== run.id);
          return [run, ...without];
        });
        if (run.status !== "running") setActiveRunId(null);
      } catch {
        // Leave the active id so the next tick retries; surface nothing noisy mid-poll.
      }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeRunId, bundleId]);

  async function handleCompile() {
    setSubmitting(true);
    setError(null);
    try {
      const { runId } = await compileBundle(bundleId);
      setActiveRunId(runId);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start compilation");
    } finally {
      setSubmitting(false);
    }
  }

  const latest = runs?.[0] ?? null;
  const busy = submitting || activeRunId !== null;

  return (
    <section className="border-border flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SparklesIcon className="text-primary size-4 shrink-0" />
            {t.compile.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {t.compile.description}
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void handleCompile()}>
          {busy ? (
            <>
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              {t.compile.compiling}
            </>
          ) : (
            t.compile.button
          )}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.compile.failed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {latest?.status === "succeeded" && latest.mrId ? (
        <Alert>
          <AlertTitle>{t.compile.succeeded}</AlertTitle>
          <AlertDescription>
            <Link
              href={`/bundles/${bundleId}/merge-requests/${latest.mrId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {t.compile.viewMr}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {latest?.status === "succeeded" && !latest.mrId ? (
        <Alert>
          <AlertTitle>{t.compile.upToDate}</AlertTitle>
        </Alert>
      ) : null}

      {latest?.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>{t.compile.failed}</AlertTitle>
          <AlertDescription>{latest.error ?? t.compile.failed}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <h3 className="text-muted-foreground mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.06em]">
          {t.compile.recentRuns}
        </h3>
        {runs === null ? (
          <p className="text-muted-foreground text-xs">{t.common.loading}</p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t.compile.noRuns}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {runs.slice(0, 5).map((run) => (
              <li
                key={run.id}
                className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
              >
                <Badge variant={statusVariant(run.status)}>
                  {run.status === "running"
                    ? t.compile.statusRunning
                    : run.status === "succeeded"
                      ? t.compile.statusSucceeded
                      : t.compile.statusFailed}
                </Badge>
                <span>{formatTimestamp(run.startedAt)}</span>
                {run.triggeredBy ? (
                  <span>{t.compile.triggeredBy(run.triggeredBy.displayName)}</span>
                ) : null}
                {run.stats ? <span>{t.compile.docsWritten(run.stats.docsWritten)}</span> : null}
                {run.stats?.skippedUnchanged ? (
                  <span>{t.compile.skippedUnchanged(run.stats.skippedUnchanged)}</span>
                ) : null}
                {run.mrId ? (
                  <Link
                    href={`/bundles/${bundleId}/merge-requests/${run.mrId}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t.compile.viewMr}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
