"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Select } from "@kherad/ui/components/ui/select";
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
  createWikiVersion,
  deleteWikiVersion,
  fetchBundle,
  fetchWikiCommits,
  fetchWikiVersions,
  restoreWikiVersion,
  type AdminBundle,
  type WikiCommit,
  type WikiVersion,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AdminBundleVersionsPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [versions, setVersions] = useState<WikiVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [commits, setCommits] = useState<WikiCommit[]>([]);
  // "" = snapshot the bundle's current pages (main tip); otherwise a picked commit oid.
  const [fromOid, setFromOid] = useState("");

  const [restoreTarget, setRestoreTarget] = useState<WikiVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WikiVersion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    () => fetchWikiVersions(bundleId).then(setVersions),
    [bundleId],
  );

  useEffect(() => {
    fetchBundle(bundleId).then(setBundle, (err) =>
      setError(err instanceof Error ? err.message : t.admin.loadBundlesFailed),
    );
  }, [bundleId, t.admin.loadBundlesFailed]);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : t.admin.loadVersionsFailed),
    );
  }, [load, t.admin.loadVersionsFailed]);

  useEffect(() => {
    fetchWikiCommits(bundleId).then(setCommits, (err) =>
      setError(err instanceof Error ? err.message : t.admin.loadCommitsFailed),
    );
  }, [bundleId, t.admin.loadCommitsFailed]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const version = await createWikiVersion(bundleId, name.trim(), fromOid || undefined);
      setName("");
      setFromOid("");
      setNotice(t.admin.versionCreated(version.name));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.createVersionFailed);
    } finally {
      setCreating(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    setNotice(null);
    try {
      const result = await restoreWikiVersion(bundleId, restoreTarget.name);
      setNotice(
        result.restored
          ? t.admin.restoreSuccess(result.pagesUpserted, result.pagesDeleted)
          : t.admin.restoreNoop,
      );
      setRestoreTarget(null);
      await load();
      // Restoring adds a commit on main — refresh the snapshot-source list.
      fetchWikiCommits(bundleId).then(setCommits, () => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.restoreVersionFailed);
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteWikiVersion(bundleId, deleteTarget.name);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.deleteVersionFailed);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

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
          {t.admin.versionsHeading}
          {bundle ? ` — ${bundle.title}` : ""}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.admin.versionsDesc}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>{notice}</AlertTitle>
        </Alert>
      ) : null}

      <div className="border-border flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="version-name">{t.admin.versionName}</Label>
          <Input
            id="version-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.admin.versionNamePlaceholder}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="version-source">{t.admin.versionSource}</Label>
          <Select
            id="version-source"
            value={fromOid}
            onChange={(e) => setFromOid(e.target.value)}
            className="max-w-md"
          >
            <option value="">{t.admin.versionSourceCurrent}</option>
            {commits.map((commit) => (
              <option key={commit.oid} value={commit.oid}>
                {commit.oid.slice(0, 7)} · {formatTimestamp(commit.committedAt)} · {commit.summary}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" disabled={creating || !name.trim()} onClick={handleCreate}>
          {creating ? t.admin.creatingVersion : t.admin.createVersion}
        </Button>
      </div>

      {versions === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : versions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.admin.noVersions}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.admin.versionName}</TableHead>
              <TableHead>{t.common.created}</TableHead>
              <TableHead>{t.admin.commit}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((version) => (
              <TableRow key={version.name}>
                <TableCell className="font-medium">{version.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTimestamp(version.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">{version.oid.slice(0, 7)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={restoring || deleting}
                      onClick={() => setRestoreTarget(version)}
                    >
                      {t.admin.restore}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={restoring || deleting}
                      onClick={() => setDeleteTarget(version)}
                    >
                      {t.admin.deleteVersion}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {restoreTarget ? t.admin.restoreConfirmTitle(restoreTarget.name) : ""}
            </DialogTitle>
            <DialogDescription>{t.admin.restoreConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" disabled={restoring} onClick={handleRestore}>
              {restoring ? t.admin.restoring : t.admin.restoreConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.admin.deleteVersionTitle}</DialogTitle>
            <DialogDescription>{t.admin.deleteVersionBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? t.admin.deletingVersion : t.admin.deleteVersion}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
