import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { FileTextIcon, FolderIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WikiContent } from "@/components/wiki/wiki-content";
import { getViewer } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { isFolderNode, labelFor } from "@/lib/page-tree";
import { getWikiNav, getWikiNavForVersion, type WikiNavNode } from "@/lib/wiki-nav";
import { resolveWikiPage } from "@/lib/wiki-render";

type Props = {
  params: Promise<{ bundleSlug: string }>;
  searchParams: Promise<{ version?: string }>;
};

function countPages(node: WikiNavNode): number {
  // Folders are not documents — only count leaf pages (and any page nested under).
  const self = !isFolderNode(node) && node.page ? 1 : 0;
  return self + node.children.reduce((sum, child) => sum + countPages(child), 0);
}

/** First descendant document; folders themselves are never treated as pages. */
function firstPage(node: WikiNavNode): WikiNavNode | null {
  if (!isFolderNode(node)) return node.page ? node : null;
  for (const child of node.children) {
    const found = firstPage(child);
    if (found) return found;
  }
  return null;
}

export default async function BundleIndexPage({ params, searchParams }: Props) {
  const { bundleSlug } = await params;
  const { version } = await searchParams;
  const t = await getDictionary();
  const viewer = await getViewer();
  let nav = await getWikiNav(bundleSlug, viewer);
  if (!nav) notFound();

  // At a version snapshot the index (card grid / first-page redirect) must
  // list that snapshot's pages, not the live hierarchy.
  const versionNav = version ? await getWikiNavForVersion(bundleSlug, viewer, version) : null;
  if (versionNav) nav = versionNav;

  const versionSuffix = versionNav ? `?version=${encodeURIComponent(version!)}` : "";

  // Compiled wiki: prefer rendering the OKF index.md as the home page.
  if (nav.bundle.mode === "llm_compiled") {
    const index = await resolveWikiPage(bundleSlug, ["index"], null, viewer, version ?? null);
    if (index.kind === "ok") {
      return (
        <article className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
          <header className="border-border mb-8 flex flex-col gap-2 border-b pb-5">
            <div className="flex items-center gap-3">
              <h1 dir="auto">{index.title}</h1>
              {nav.bundle.isPublic ? <Badge variant="success">{t.common.public}</Badge> : null}
              {index.version ? (
                <Badge variant="secondary">{t.wiki.viewingVersion(index.version)}</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">{t.wiki.compiledKb}</p>
          </header>
          <WikiContent html={index.html} />
        </article>
      );
    }
    if (index.kind === "forbidden") {
      return (
        <div className="mx-auto w-full max-w-2xl p-8">
          <Alert variant="destructive">
            <AlertTitle>{viewer ? t.wiki.accessDenied : t.wiki.signInRequired}</AlertTitle>
            <AlertDescription>
              {viewer ? t.wiki.noPermissionBundle : t.wiki.notPublicBundle}
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    // No index yet — if any other OKF docs exist, send the reader to the first one.
    const first = nav.tree.map(firstPage).find((n) => n?.page);
    if (first?.page && first.page.path !== "index") {
      redirect(`/wiki/${bundleSlug}/${first.page.path}${versionSuffix}`);
    }
    return (
      <div className="mx-auto w-full max-w-2xl p-8">
        <Alert>
          <AlertTitle dir="auto">{nav.bundle.title}</AlertTitle>
          <AlertDescription>{t.wiki.noCompiledKb}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (nav.pageCount === 0) {
    const signedIn = viewer !== null;
    const emptyButAllowed = nav.bundle.isPublic || viewer?.isAdmin;
    return (
      <div className="mx-auto w-full max-w-2xl p-8">
        {emptyButAllowed ? (
          <Alert>
            <AlertTitle dir="auto">{nav.bundle.title}</AlertTitle>
            <AlertDescription>{t.wiki.noPagesYet}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>{signedIn ? t.wiki.accessDenied : t.wiki.signInRequired}</AlertTitle>
            <AlertDescription>
              {signedIn ? t.wiki.noPermissionBundle : t.wiki.notPublicBundle}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 dir="auto">{nav.bundle.title}</h1>
          {nav.bundle.isPublic ? <Badge variant="success">{t.common.public}</Badge> : null}
          {versionNav ? <Badge variant="secondary">{t.wiki.viewingVersion(version!)}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-sm">
          {t.wiki.pageCount(nav.pageCount)} ·{" "}
          <span className="font-mono text-xs">{nav.bundle.slug}</span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {nav.tree.map((node) => {
          const isFolder = isFolderNode(node);
          const target = isFolder ? firstPage(node) : node;
          if (!target?.page) return null;
          return (
            <Link
              key={node.path}
              href={`/wiki/${nav.bundle.slug}/${target.page.path}${versionSuffix}`}
              className="surface-card surface-card-interactive group flex items-start gap-3 rounded-xl p-4"
            >
              <span className="bg-primary/12 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg">
                {isFolder ? (
                  <FolderIcon className="size-4.5" />
                ) : (
                  <FileTextIcon className="size-4.5" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="group-hover:text-primary truncate font-medium">
                  {labelFor(node)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {isFolder ? t.wiki.pageCountInline(countPages(node)) : `/${node.path}`}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
