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
import { ArrowLeft, PencilIcon, WaypointsIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CompilePanel } from "@/components/compile/compile-panel";
import {
  createPage,
  fetchBundle,
  fetchBundlePages,
  type AdminBundle,
  type PageSummary,
} from "@/lib/api-client";
import { pagePathFromTitle } from "@kherad/core/page-paths";
import { useI18n } from "@/lib/i18n/provider";

export default function BundleDetailPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const suggestedPath = title.trim() && !path.trim() ? pagePathFromTitle(title) : "";

  const load = useCallback(async () => {
    const [bundleRow, pageRows] = await Promise.all([
      fetchBundle(bundleId),
      fetchBundlePages(bundleId),
    ]);
    setBundle(bundleRow);
    setPages(pageRows);
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
        {pages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {bundle.mode === "llm_compiled" ? t.bundles.emptySources : t.bundles.emptyDocuments}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pages.map((page) => {
              const viewHref =
                bundle.mode === "llm_compiled"
                  ? `/sources/${bundle.slug}/${page.path}`
                  : `/wiki/${bundle.slug}/${page.path}`;
              return (
                <li
                  key={page.id}
                  className="surface-card surface-card-interactive flex items-center justify-between gap-3 rounded-xl p-3.5"
                >
                  <Link href={viewHref} className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium" dir="auto">
                      {page.title}
                    </span>
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      /{page.path}
                    </span>
                  </Link>
                  <Link
                    href={`/bundles/${bundleId}/pages/${page.id}/edit`}
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
                  >
                    <PencilIcon className="size-3.5" />
                    {t.common.edit}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
