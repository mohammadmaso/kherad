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
import { useCallback, useEffect, useState } from "react";

import { CompilePanel } from "@/components/compile/compile-panel";
import { DocTree } from "@/components/wiki/doc-tree";
import {
  createPage,
  deleteFolder,
  deletePage,
  fetchBundle,
  fetchBundlePages,
  fetchOkfDocs,
  type AdminBundle,
  type OkfDocSummary,
  type PageSummary,
} from "@/lib/api-client";
import { pagePathFromTitle } from "@kherad/core/page-paths";
import { buildTree, type WikiNavNode } from "@/lib/page-tree";
import { useI18n } from "@/lib/i18n/provider";

type DeleteTarget =
  | { kind: "page"; page: PageSummary }
  | { kind: "folder"; path: string; name: string; count: number };

function countPagesUnder(pages: PageSummary[], prefix: string): number {
  return pages.filter((page) => page.path === prefix || page.path.startsWith(`${prefix}/`)).length;
}

export default function BundleDetailPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [okfDocs, setOkfDocs] = useState<OkfDocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const suggestedPath = title.trim() && !path.trim() ? pagePathFromTitle(title) : "";

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    const bundleRow = await fetchBundle(bundleId);
    const [pageRows, okfDocRows] = await Promise.all([
      fetchBundlePages(bundleId),
      bundleRow.mode === "llm_compiled" ? fetchOkfDocs(bundleId) : Promise.resolve(null),
    ]);
    setBundle(bundleRow);
    setPages(pageRows);
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
    try {
      const page = await createPage(bundleId, { path, title });
      setDialogOpen(false);
      setPath("");
      setTitle("");
      router.push(`/bundles/${bundleId}/pages/${page.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bundles.createFailed);
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
    const isFolder = node.children.length > 0;
    return (
      <>
        {node.page ? (
          <Link
            href={`/bundles/${bundleId}/pages/${node.page.id}/edit`}
            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
            aria-label={t.common.edit}
          >
            <PencilIcon className="size-3.5" />
          </Link>
        ) : null}
        {isFolder ? (
          <button
            type="button"
            onClick={() => openDeleteFolder(node)}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
            aria-label={t.bundles.deleteFolder}
          >
            <Trash2Icon className="size-3.5" />
          </button>
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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              {bundle.mode === "llm_compiled" ? t.bundles.newSource : t.bundles.newDocument}
            </Button>
          </div>
          <DialogContent>
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-path">{t.bundles.pathOptional}</Label>
                <Input
                  id="doc-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={suggestedPath || "getting-started"}
                />
                {suggestedPath ? (
                  <p className="text-muted-foreground text-xs">
                    {t.bundles.pathHintPrefix}{" "}
                    <span className="font-mono">/{suggestedPath}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button disabled={submitting || !title.trim()} onClick={handleCreate}>
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

      {bundle.mode === "llm_compiled" ? <CompilePanel bundleId={bundleId} /> : null}

      <div>
        <h2 className="text-muted-foreground mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.06em]">
          {bundle.mode === "llm_compiled" ? t.bundles.sourceDocuments : t.bundles.documents}
        </h2>
        <DocTree
          tree={buildTree(pages)}
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
