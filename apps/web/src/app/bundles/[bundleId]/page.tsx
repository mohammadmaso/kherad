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
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { ArrowLeft, PencilIcon, Trash2Icon, WaypointsIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CompilePanel } from "@/components/compile/compile-panel";
import { DocTree } from "@/components/wiki/doc-tree";
import { PagePathFields } from "@/components/wiki/page-path-fields";
import {
  createFolder,
  createPage,
  deleteFolder,
  deletePage,
  fetchBundle,
  fetchBundleFolders,
  fetchBundlePages,
  fetchOkfDocs,
  renameFolder,
  submitForReview,
  type AdminBundle,
  type OkfDocSummary,
  type PageSummary,
} from "@/lib/api-client";
import { resolveCreatePagePath, slugifyPagePath } from "@kherad/core/page-paths";
import { buildTree, existingFolderPaths, isFolderNode, type WikiNavNode } from "@/lib/page-tree";
import { useI18n } from "@/lib/i18n/provider";

type DeleteTarget =
  | { kind: "page"; page: PageSummary }
  | { kind: "folder"; path: string; name: string; count: number };

type RenameFolderTarget = { path: string; name: string };

function countPagesUnder(pages: PageSummary[], prefix: string): number {
  return pages.filter((page) => page.path === prefix || page.path.startsWith(`${prefix}/`)).length;
}

export default function BundleDetailPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [okfDocs, setOkfDocs] = useState<OkfDocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [parentPath, setParentPath] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const existingFolders = useMemo(
    () => existingFolderPaths(pages ?? [], emptyFolders),
    [pages, emptyFolders],
  );
  const docTree = useMemo(() => buildTree(pages ?? [], emptyFolders), [pages, emptyFolders]);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameFolderTarget | null>(null);
  const [renamePath, setRenamePath] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  function openCreateDialog() {
    setParentPath("");
    setPath("");
    setTitle("");
    setDialogOpen(true);
  }

  function closeCreateDialog() {
    setDialogOpen(false);
    setParentPath("");
    setPath("");
    setTitle("");
  }

  function openFolderDialog() {
    setFolderPath("");
    setFolderDialogOpen(true);
  }

  function closeFolderDialog() {
    setFolderDialogOpen(false);
    setFolderPath("");
  }

  const load = useCallback(async () => {
    const bundleRow = await fetchBundle(bundleId);
    const [pageRows, folderRows, okfDocRows] = await Promise.all([
      fetchBundlePages(bundleId),
      fetchBundleFolders(bundleId).catch(() => [] as string[]),
      bundleRow.mode === "llm_compiled" ? fetchOkfDocs(bundleId) : Promise.resolve(null),
    ]);
    setBundle(bundleRow);
    setPages(pageRows);
    setEmptyFolders(folderRows);
    setOkfDocs(okfDocRows);
  }, [bundleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t.bundles.loadFailed;
        if (message.includes("Forbidden")) setForbidden(true);
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, t.bundles.loadFailed]);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const resolvedPath = resolveCreatePagePath({
        folder: parentPath,
        path,
        title,
      });
      if (!resolvedPath) {
        setError(t.bundles.createFailed);
        return;
      }
      const page = await createPage(bundleId, { path: resolvedPath, title });
      closeCreateDialog();
      router.push(`/bundles/${bundleId}/pages/${page.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bundles.createFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFolder(submitReview: boolean) {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const resolved = slugifyPagePath(folderPath);
      if (!resolved) {
        setError(t.bundles.folderCreateFailed);
        return;
      }
      const result = await createFolder(bundleId, resolved);
      if (submitReview) {
        await submitForReview(bundleId);
        setSuccess(t.bundles.folderCreateSubmitted(result.path));
      } else {
        setSuccess(t.bundles.folderCreateSuccess(result.path));
      }
      closeFolderDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bundles.folderCreateFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function openDeletePage(pageId: string) {
    const page = pages?.find((row) => row.id === pageId);
    if (!page) return;
    setDeleteTarget({ kind: "page", page });
    setDeleteConfirmName("");
  }

  function openDeleteFolder(node: WikiNavNode) {
    if (!pages) return;
    setDeleteTarget({
      kind: "folder",
      path: node.path,
      name: node.name,
      count: countPagesUnder(pages, node.path),
    });
    setDeleteConfirmName("");
  }

  function openRenameFolder(node: WikiNavNode) {
    setRenameTarget({ path: node.path, name: node.name });
    setRenamePath(node.path);
  }

  function closeRenameDialog() {
    setRenameTarget(null);
    setRenamePath("");
  }

  async function handleRenameFolder() {
    if (!renameTarget) return;
    setRenameSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const next = slugifyPagePath(renamePath);
      if (!next) {
        setError(t.bundles.renameFolderFailed);
        return;
      }
      const result = await renameFolder(bundleId, renameTarget.path, next);
      await submitForReview(bundleId);
      setSuccess(t.bundles.renameFolderSubmitted(result.pathPrefix, result.newPath));
      closeRenameDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bundles.renameFolderFailed);
    } finally {
      setRenameSubmitting(false);
    }
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteConfirmName("");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      if (deleteTarget.kind === "page") {
        await deletePage(bundleId, deleteTarget.page.id, deleteConfirmName);
      } else {
        await deleteFolder(bundleId, deleteTarget.path, deleteConfirmName);
      }
      closeDeleteDialog();
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : deleteTarget.kind === "page"
            ? t.bundles.deleteDocumentFailed
            : t.bundles.deleteFolderFailed,
      );
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const expectedConfirmName =
    deleteTarget?.kind === "page" ? deleteTarget.page.title : deleteTarget?.name;

  function renderSourceActions(node: WikiNavNode) {
    const isFolder = isFolderNode(node);
    return (
      <>
        {!isFolder && node.page ? (
          <Link
            href={`/bundles/${bundleId}/pages/${node.page.id}/edit`}
            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
            aria-label={t.common.edit}
          >
            <PencilIcon className="size-3.5" />
          </Link>
        ) : null}
        {isFolder ? (
          <>
            <button
              type="button"
              onClick={() => openRenameFolder(node)}
              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
              aria-label={t.bundles.renameFolder}
            >
              <PencilIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => openDeleteFolder(node)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
              aria-label={t.bundles.deleteFolder}
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </>
        ) : node.page ? (
          <button
            type="button"
            onClick={() => openDeletePage(node.page!.id)}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
            aria-label={t.bundles.deleteDocument}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        ) : null}
      </>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.bundles.accessDenied}</AlertTitle>
          <AlertDescription>{t.bundles.noPermission}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.bundles.loadTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!bundle || !pages) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors duration-150"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t.bundles.backDocs}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl" dir="auto">
              {bundle.title}
            </h1>
            {bundle.mode === "llm_compiled" ? (
              <Badge variant="default">{t.bundles.aiCompiledBadge}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-xs">{bundle.slug}</p>
          {bundle.mode === "llm_compiled" ? (
            <p className="text-muted-foreground mt-2 max-w-md text-sm">{t.bundles.sourcesHint}</p>
          ) : null}
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (open) openCreateDialog();
            else closeCreateDialog();
          }}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/wiki/${bundle.slug}`} />}
            >
              {t.bundles.viewWiki}
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/bundles/${bundleId}/graph`} />}
            >
              <WaypointsIcon className="size-3.5" />
              {t.bundles.graph}
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/bundles/${bundleId}/ingest`} />}
            >
              {t.bundles.importDocument}
            </Button>
            <Button variant="outline" size="sm" onClick={openFolderDialog}>
              {t.bundles.newFolder}
            </Button>
            <Button size="sm" onClick={openCreateDialog}>
              {bundle.mode === "llm_compiled" ? t.bundles.newSource : t.bundles.newDocument}
            </Button>
          </div>
          <DialogContent className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t.bundles.newDocument}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-title">{t.bundles.titleLabel}</Label>
                <Input
                  id="doc-title"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.bundles.titlePlaceholder}
                />
              </div>
              <PagePathFields
                folder={parentPath}
                onFolderChange={setParentPath}
                path={path}
                onPathChange={setPath}
                title={title}
                existingFolders={existingFolders}
                labels={{
                  pathFolderLabel: t.bundles.pathFolderLabel,
                  pathFolderPlaceholder: t.bundles.pathFolderPlaceholder,
                  pathFolderHint: t.bundles.pathFolderHint,
                  pathDocLabel: t.bundles.pathDocLabel,
                  pathDocPlaceholder: t.bundles.pathDocPlaceholder,
                  pathParentRoot: t.bundles.pathParentRoot,
                  pathAddSubfolder: t.bundles.pathAddSubfolder,
                  pathCreatesPrefix: t.bundles.pathCreatesPrefix,
                }}
              />
            </div>
            <DialogFooter className="mt-0">
              <Button variant="outline" onClick={closeCreateDialog}>
                {t.common.cancel}
              </Button>
              <Button disabled={submitting || !title.trim()} onClick={handleCreate}>
                {t.common.create}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {bundle.mode === "llm_compiled" ? <CompilePanel bundleId={bundleId} /> : null}

      <div>
        <h2 className="text-muted-foreground mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.06em]">
          {bundle.mode === "llm_compiled" ? t.bundles.sourceDocuments : t.bundles.documents}
        </h2>
        <DocTree
          tree={docTree}
          linkFor={(node) =>
            bundle.mode === "llm_compiled"
              ? `/sources/${bundle.slug}/${node.path}`
              : `/wiki/${bundle.slug}/${node.path}`
          }
          renderActions={renderSourceActions}
          emptyMessage={
            bundle.mode === "llm_compiled" ? t.bundles.emptySources : t.bundles.emptyDocuments
          }
        />
      </div>

      {bundle.mode === "llm_compiled" ? (
        <div>
          <h2 className="text-muted-foreground mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.06em]">
            {t.okfDocs.sectionTitle}
          </h2>
          <DocTree
            tree={buildTree((okfDocs ?? []).map((doc) => ({ id: doc.path, ...doc })))}
            linkFor={(node) => `/wiki/${bundle.slug}/${node.path}`}
            renderActions={(node) => {
              const doc = okfDocs?.find((d) => d.path === node.path);
              if (!doc || doc.readonly) return null;
              return (
                <Link
                  href={`/bundles/${bundleId}/okf-docs/edit/${node.path}`}
                  className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
                  aria-label={t.common.edit}
                >
                  <PencilIcon className="size-3.5" />
                </Link>
              );
            }}
            emptyMessage={t.okfDocs.empty}
          />
        </div>
      ) : null}

      <Dialog
        open={folderDialogOpen}
        onOpenChange={(open) => {
          if (open) openFolderDialog();
          else closeFolderDialog();
        }}
      >
        <DialogContent className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.bundles.newFolder}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{t.bundles.folderCreateHint}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="folder-path">{t.bundles.folderPathLabel}</Label>
              <Input
                id="folder-path"
                autoFocus
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder={t.bundles.folderPathPlaceholder}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="font-mono"
              />
              {slugifyPagePath(folderPath) ? (
                <p className="text-muted-foreground text-xs">
                  {t.bundles.pathCreatesPrefix}{" "}
                  <span className="text-foreground/80 font-mono">
                    /{slugifyPagePath(folderPath)}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter className="mt-0 flex-wrap gap-2">
            <Button variant="outline" onClick={closeFolderDialog}>
              {t.common.cancel}
            </Button>
            <Button
              variant="outline"
              disabled={submitting || !slugifyPagePath(folderPath)}
              onClick={() => void handleCreateFolder(false)}
            >
              {t.bundles.folderCreate}
            </Button>
            <Button
              disabled={submitting || !slugifyPagePath(folderPath)}
              onClick={() => void handleCreateFolder(true)}
            >
              {t.bundles.folderCreateAndSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.bundles.renameFolderTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{t.bundles.renameFolderDesc}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rename-folder-path">{t.bundles.renameFolderPathLabel}</Label>
              <Input
                id="rename-folder-path"
                autoFocus
                value={renamePath}
                onChange={(e) => setRenamePath(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="font-mono"
              />
              {renameTarget && slugifyPagePath(renamePath) ? (
                <p className="text-muted-foreground text-xs">
                  <span className="font-mono">/{renameTarget.path}</span>
                  {" → "}
                  <span className="text-foreground/80 font-mono">
                    /{slugifyPagePath(renamePath)}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter className="mt-0">
            <Button variant="outline" onClick={closeRenameDialog}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={
                renameSubmitting ||
                !renameTarget ||
                !slugifyPagePath(renamePath) ||
                slugifyPagePath(renamePath) === renameTarget.path
              }
              onClick={() => void handleRenameFolder()}
            >
              {t.bundles.renameFolder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.kind === "folder"
                ? t.bundles.deleteFolderTitle
                : t.bundles.deleteDocumentTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {deleteTarget?.kind === "folder"
                ? t.bundles.deleteFolderDesc(deleteTarget.count)
                : t.bundles.deleteDocumentDesc}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-confirm-name">
                {expectedConfirmName
                  ? t.bundles.deleteConfirmLabel(expectedConfirmName)
                  : t.bundles.deleteConfirmPlaceholder}
              </Label>
              <Input
                id="delete-confirm-name"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={t.bundles.deleteConfirmPlaceholder}
                autoComplete="off"
                spellCheck={false}
                dir="auto"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleteSubmitting ||
                !expectedConfirmName ||
                deleteConfirmName !== expectedConfirmName
              }
              onClick={() => void handleDelete()}
            >
              {deleteTarget?.kind === "folder"
                ? t.bundles.deleteFolder
                : t.bundles.deleteDocument}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
