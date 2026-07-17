"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Checkbox } from "@kherad/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kherad/ui/components/ui/dropdown-menu";
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
import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  archiveBundle,
  createBundle,
  fetchBundles,
  setBundleMode,
  unarchiveBundle,
  updateBundle,
  type AdminBundle,
  type BundleMode,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AdminBundlesPage() {
  const { t } = useI18n();
  const [bundles, setBundles] = useState<AdminBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  const [editingBundle, setEditingBundle] = useState<AdminBundle | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [editMode, setEditMode] = useState<BundleMode>("raw");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const load = useCallback(() => {
    return fetchBundles().then(setBundles);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : t.admin.loadBundlesFailed),
    );
  }, [load, t.admin.loadBundlesFailed]);

  function resetForm() {
    setSlug("");
    setTitle("");
    setIsPublic(false);
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      await createBundle({ slug, title, isPublic });
      setDialogOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.createBundleFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(bundleId: string) {
    setPendingArchiveId(bundleId);
    setError(null);
    try {
      await archiveBundle(bundleId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.archiveFailed);
    } finally {
      setPendingArchiveId(null);
    }
  }

  async function handleUnarchive(bundleId: string) {
    setPendingArchiveId(bundleId);
    setError(null);
    try {
      await unarchiveBundle(bundleId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.unarchiveFailed);
    } finally {
      setPendingArchiveId(null);
    }
  }

  function openEdit(bundle: AdminBundle) {
    setEditingBundle(bundle);
    setEditTitle(bundle.title);
    setEditIsPublic(bundle.isPublic);
    setEditMode(bundle.mode);
  }

  async function handleEditSave() {
    if (!editingBundle) return;
    setEditSubmitting(true);
    setError(null);
    try {
      await updateBundle(editingBundle.id, { title: editTitle, isPublic: editIsPublic });
      if (editMode !== editingBundle.mode) {
        await setBundleMode(editingBundle.id, editMode);
      }
      setEditingBundle(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.admin.updateBundleFailed);
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.admin.bundles}</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            {t.admin.newBundle}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.admin.createBundle}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slug">{t.admin.slug}</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="engineering"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">{t.common.title}</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Engineering"
                />
              </div>
              <Label htmlFor="isPublic">
                <Checkbox
                  id="isPublic"
                  checked={isPublic}
                  onCheckedChange={(checked) => setIsPublic(checked === true)}
                />
                {t.admin.publicCheckbox}
              </Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button disabled={submitting || !slug || !title} onClick={handleCreate}>
                {t.common.create}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {bundles === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : bundles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.admin.noBundles}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.admin.slug}</TableHead>
              <TableHead>{t.common.title}</TableHead>
              <TableHead>{t.admin.visibility}</TableHead>
              <TableHead>{t.bundles.mode}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              <TableHead>{t.common.created}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bundles.map((bundle) => (
              <TableRow key={bundle.id}>
                <TableCell className="font-mono text-xs">{bundle.slug}</TableCell>
                <TableCell>{bundle.title}</TableCell>
                <TableCell>
                  <Badge variant={bundle.isPublic ? "success" : "outline"}>
                    {bundle.isPublic ? t.common.public : t.common.private}
                  </Badge>
                </TableCell>
                <TableCell>
                  {bundle.mode === "llm_compiled" ? (
                    <Badge variant="default">{t.bundles.aiCompiledBadge}</Badge>
                  ) : (
                    <Badge variant="outline">{t.bundles.modeRaw}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {bundle.archivedAt ? (
                    <Badge variant="warning">{t.common.archived}</Badge>
                  ) : (
                    <Badge variant="secondary">{t.common.active}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatTimestamp(bundle.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={t.admin.actionsFor(bundle.title)}
                          >
                            <MoreHorizontalIcon className="size-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => openEdit(bundle)}>
                          {t.common.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<Link href={`/admin/bundles/${bundle.id}/permissions`} />}
                        >
                          {t.admin.permissions}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<Link href={`/admin/bundles/${bundle.id}/audit`} />}
                        >
                          {t.admin.audit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<Link href={`/admin/bundles/${bundle.id}/remote`} />}
                        >
                          {t.admin.bundleRemote}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<Link href={`/admin/bundles/${bundle.id}/versions`} />}
                        >
                          {t.admin.versions}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {bundle.archivedAt ? (
                          <DropdownMenuItem
                            disabled={pendingArchiveId === bundle.id}
                            onClick={() => handleUnarchive(bundle.id)}
                          >
                            {t.admin.unarchive}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={pendingArchiveId === bundle.id}
                            onClick={() => handleArchive(bundle.id)}
                          >
                            {t.admin.archive}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={editingBundle !== null}
        onOpenChange={(open) => !open && setEditingBundle(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.admin.editBundle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-slug">{t.admin.slug}</Label>
              <Input id="edit-slug" value={editingBundle?.slug ?? ""} disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-title">{t.common.title}</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <Label htmlFor="edit-isPublic">
              <Checkbox
                id="edit-isPublic"
                checked={editIsPublic}
                onCheckedChange={(checked) => setEditIsPublic(checked === true)}
              />
              {t.admin.publicCheckbox}
            </Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-mode">{t.bundles.mode}</Label>
              <Select
                id="edit-mode"
                value={editMode}
                onChange={(e) => setEditMode(e.target.value as BundleMode)}
              >
                <option value="raw">{t.bundles.modeRaw}</option>
                <option value="llm_compiled">{t.bundles.modeLlm}</option>
              </Select>
              <p className="text-muted-foreground text-xs">{t.bundles.modeHint}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBundle(null)}>
              {t.common.cancel}
            </Button>
            <Button disabled={editSubmitting || !editTitle.trim()} onClick={handleEditSave}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
