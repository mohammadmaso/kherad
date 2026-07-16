import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Button } from "@kherad/ui/components/ui/button";
import { ChevronRightIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WikiContent } from "@/components/wiki/wiki-content";
import { getViewer } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { resolveSourcePage } from "@/lib/source-render";

type Props = {
  params: Promise<{ bundleSlug: string; path: string[] }>;
};

function prettify(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

/**
 * Author-facing raw source viewer. Separate from `/wiki`, which for
 * `llm_compiled` bundles shows only the approved OKF knowledge base.
 */
export default async function SourcePage({ params }: Props) {
  const { bundleSlug, path } = await params;
  const t = await getDictionary();
  const viewer = await getViewer();
  const result = await resolveSourcePage(bundleSlug, path, viewer);

  if (result.kind === "not-found") notFound();
  if (result.kind === "redirect") redirect(result.to);

  if (result.kind === "forbidden") {
    return (
      <div className="mx-auto w-full max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertTitle>{result.signedIn ? t.wiki.accessDenied : t.wiki.signInRequired}</AlertTitle>
          <AlertDescription>
            {result.signedIn ? t.wiki.noPermissionSource : t.wiki.signInForAccess}
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
          <AlertDescription>{t.wiki.sourceRemoved}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const crumbs = path.slice(0, -1);
  const editButton = result.canEdit ? (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<Link href={`/bundles/${result.bundleId}/pages/${result.pageId}/edit`} />}
    >
      <PencilIcon className="size-3.5" />
      {t.wiki.edit}
    </Button>
  ) : null;

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
      <nav
        aria-label={t.wiki.breadcrumb}
        className="text-muted-foreground mb-4 flex items-center gap-1 text-sm"
      >
        <Link
          href={`/bundles/${result.bundleId}`}
          className="hover:text-foreground transition-colors duration-150"
        >
          {t.wiki.sourceDocuments}
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
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.06em]">
            {t.wiki.rawSource}
          </p>
          <h1 dir="auto">{result.title}</h1>
        </div>
        {editButton}
      </header>

      {result.kind === "unpublished" ? (
        <p className="text-muted-foreground text-sm">{t.wiki.sourceUnpublished}</p>
      ) : (
        <WikiContent html={result.html} />
      )}
    </article>
  );
}
