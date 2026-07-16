"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kherad/ui/components/ui/table";
import { ArrowLeftIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  fetchBundles,
  fetchMergeRequests,
  type AdminBundle,
  type MergeRequestSummary,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Basic per-bundle audit log (Prompt 10): recently merged MRs, newest first. */
export default function AdminAuditPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [merges, setMerges] = useState<MergeRequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [bundleRows, mergeRows] = await Promise.all([
      fetchBundles(),
      fetchMergeRequests(bundleId, "merged"),
    ]);
    setBundle(bundleRows.find((b) => b.id === bundleId) ?? null);
    setMerges(mergeRows);
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.admin.loadAuditFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, t.admin.loadAuditFailed]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => router.push("/admin/bundles")}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
          {t.admin.backBundles}
        </button>
        <h2 className="mt-1 text-lg font-semibold">
          {t.admin.audit}
          {bundle ? (
            <>
              {" — "}
              <span dir="auto">{bundle.title}</span>
            </>
          ) : (
            ""
          )}
        </h2>
        <p className="text-muted-foreground text-sm">{t.admin.auditDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {merges === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : merges.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.admin.noMerges}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.admin.branch}</TableHead>
              <TableHead>{t.common.author}</TableHead>
              <TableHead>{t.admin.commit}</TableHead>
              <TableHead>{t.admin.merged}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {merges.map((mr) => (
              <TableRow
                key={mr.id}
                className="cursor-pointer"
                onClick={() => router.push(`/bundles/${bundleId}/merge-requests/${mr.id}`)}
              >
                <TableCell className="font-mono text-xs">{mr.branchName}</TableCell>
                <TableCell dir="auto">{mr.author.displayName}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {mr.headCommit.slice(0, 10)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTimestamp(mr.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
