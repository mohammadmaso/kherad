"use client";

import { Badge } from "@kherad/ui/components/ui/badge";
import { Select } from "@kherad/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kherad/ui/components/ui/table";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  fetchAdminMergeRequests,
  type AdminMergeRequestSummary,
  type MergeRequestStatus,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const STATUS_OPTIONS: MergeRequestStatus[] = ["open", "conflict", "draft", "merged", "rejected"];

const STATUS_BADGE_VARIANT: Record<
  MergeRequestStatus,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  open: "default",
  conflict: "warning",
  draft: "secondary",
  merged: "success",
  rejected: "outline",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AdminMergeRequestsPage() {
  const router = useRouter();
  const { t } = useI18n();

  const statusLabel: Record<MergeRequestStatus, string> = {
    open: t.mr.statusOpen,
    conflict: t.mr.statusConflict,
    draft: t.mr.statusDraft,
    merged: t.mr.statusMerged,
    rejected: t.mr.statusRejected,
  };

  const [status, setStatus] = useState<MergeRequestStatus>("open");
  const [mrs, setMrs] = useState<AdminMergeRequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await fetchAdminMergeRequests(status);
        if (cancelled) return;
        setMrs(rows);
        setError(null);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.mr.loadFailed);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, t.mr.loadFailed]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{t.mr.adminDescription}</p>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as MergeRequestStatus)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {statusLabel[option]}
            </option>
          ))}
        </Select>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {mrs === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : mrs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.mr.empty(statusLabel[status])}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.mr.bundle}</TableHead>
              <TableHead>{t.common.author}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              <TableHead>{t.common.updated}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mrs.map((mr) => (
              <TableRow
                key={mr.id}
                className="cursor-pointer"
                onClick={() => router.push(`/bundles/${mr.bundleId}/merge-requests/${mr.id}`)}
              >
                <TableCell>{mr.bundle.title}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{mr.author.displayName}</span>
                    <span className="text-muted-foreground text-xs">{mr.author.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_BADGE_VARIANT[mr.status]}>
                      {statusLabel[mr.status]}
                    </Badge>
                    {mr.scope === "okf" ? (
                      <Badge variant="secondary">{t.mr.aiCompiled}</Badge>
                    ) : null}
                  </div>
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
