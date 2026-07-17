import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { ChevronRightIcon, FileClockIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CopyMarkdownButton } from "@/components/wiki/copy-markdown-button";
import { WikiContent } from "@/components/wiki/wiki-content";
import { getViewer } from "@/lib/auth";
import { decodePathSegments } from "@/lib/decode-path-segments";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { getWikiNav } from "@/lib/wiki-nav";
import { resolveWikiPage } from "@/lib/wiki-render";

type Props = {
  params: Promise<{ bundleSlug: string; path: string[] }>;
  searchParams: Promise<{ branch?: string; version?: string }>;
};

function prettify(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

export default async function WikiPage({ params, searchParams }: Props) {
  const { bundleSlug, path: rawPath } = await params;
  const path = decodePathSegments(rawPath);
  const { branch, version } = await searchParams;
  const t = await getDictionary();

  const viewer = await getViewer();
  const result = await resolveWikiPage(bundleSlug, path, branch ?? null, viewer, version ?? null);

  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "redirect") {
    redirect(result.to);
  }

  if (result.kind === "forbidden") {
    return (
      <div className="mx-auto w-full max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertTitle>{result.signedIn ? t.wiki.accessDenied : t.wiki.signInRequired}</AlertTitle>
          <AlertDescription>
            {result.signedIn ? t.wiki.noPermissionPage : t.wiki.notPublicPage}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (result.kind === "tombstone") {
    return (
      <div className="mx-auto w-full max-w-2xl p-8">
        <Alert>
          <AlertTitle dir="auto">{result.title}</AlertTitle>
          <AlertDescription>{t.wiki.pageRemoved}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // Sidebar data is request-cached, so this reuses the layout's lookup; it
  // only feeds the breadcrumb's bundle title.
  const nav = await getWikiNav(bundleSlug, viewer);
  const crumbs = path.slice(0, -1);
  const versionSuffix = result.version ? `?version=${encodeURIComponent(result.version)}` : "";

  const isOkfDoc = result.pageId.startsWith("okf:");
  const editHref = isOkfDoc
    ? `/bundles/${result.bundleId}/okf-docs/edit/${path.join("/")}`
    : `/bundles/${result.bundleId}/pages/${result.pageId}/edit`;

  const editButton = result.canEdit ? (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href={editHref} />}>
      <PencilIcon className="size-3.5" />
      {t.wiki.edit}
    </Button>
  ) : null;

  const copyMarkdownButton =
    result.kind === "ok" ? (
      <CopyMarkdownButton
        markdown={result.markdown}
        label={t.wiki.copyMarkdown}
        copiedLabel={t.wiki.copied}
      />
    ) : null;

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
      <nav
        aria-label={t.wiki.breadcrumb}
        className="text-muted-foreground mb-4 flex items-center gap-1 text-sm"
      >
        <Link
          href={`/wiki/${bundleSlug}${versionSuffix}`}
          className="hover:text-foreground transition-colors duration-150"
          dir="auto"
        >
          {nav?.bundle.title ?? bundleSlug}
        </Link>
        {crumbs.map((segment, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRightIcon className="size-3.5 opacity-60 rtl:rotate-180" />
            <span>{prettify(segment)}</span>
          </span>
        ))}
        <ChevronRightIcon className="size-3.5 opacity-60 rtl:rotate-180" />
        <span className="text-foreground truncate" dir="auto">
          {result.title}
        </span>
      </nav>

      <header className="border-border mb-8 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 dir="auto">{result.title}</h1>
          {result.kind === "ok" && result.isPreview ? (
            <Badge variant="warning" className="w-fit">
              {t.wiki.preview(result.branch)}
            </Badge>
          ) : null}
          {result.version ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="w-fit">
                {t.wiki.viewingVersion(result.version)}
              </Badge>
              <Link
                href={`/wiki/${bundleSlug}/${path.join("/")}`}
                className="text-primary text-xs hover:underline"
              >
                {t.wiki.backToCurrent}
              </Link>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {copyMarkdownButton}
          {editButton}
        </div>
      </header>

      {result.kind === "unpublished" ? (
        <div className="surface-card flex flex-col items-center gap-3 rounded-xl px-6 py-12 text-center">
          <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
            <FileClockIcon className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t.wiki.notPublished}</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              {result.version
                ? t.wiki.notInVersion(result.version)
                : t.wiki.notPublishedBody(result.branch)}
            </p>
          </div>
          {editButton}
        </div>
      ) : (
        <WikiContent html={result.html} />
      )}
    </article>
  );
}
