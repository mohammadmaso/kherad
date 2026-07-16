import { notFound } from "next/navigation";

import { LinkGraph } from "@/components/wiki/link-graph";
import { getViewer } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { getWikiNav } from "@/lib/wiki-nav";

type Props = { params: Promise<{ bundleSlug: string }> };

export default async function WikiGraphPage({ params }: Props) {
  const { bundleSlug } = await params;
  const t = await getDictionary();
  const viewer = await getViewer();
  const nav = await getWikiNav(bundleSlug, viewer);
  if (!nav) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t.graph.title}</h1>
        <p className="text-muted-foreground text-sm">{t.graph.descriptionNamed(nav.bundle.title)}</p>
      </header>

      <LinkGraph
        bundleId={nav.bundle.id}
        bundleSlug={nav.bundle.slug}
        bundleTitle={nav.bundle.title}
      />
    </div>
  );
}
