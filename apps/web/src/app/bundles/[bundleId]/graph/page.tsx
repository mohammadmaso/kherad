"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LinkGraph } from "@/components/wiki/link-graph";
import { fetchBundle, type AdminBundle } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export default function BundleGraphPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const { t } = useI18n();
  const [bundle, setBundle] = useState<AdminBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bundleRow = await fetchBundle(bundleId);
        if (!cancelled) setBundle(bundleRow);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.graph.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId, t.graph.loadFailed]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{t.graph.loadTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!bundle) {
    return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <Link
          href={`/bundles/${bundleId}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors duration-150"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" />
          <span dir="auto">{bundle.title}</span>
        </Link>
        <h1 className="mt-2 text-2xl">{t.graph.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.graph.description}</p>
      </div>

      <LinkGraph bundleId={bundle.id} bundleSlug={bundle.slug} bundleTitle={bundle.title} />
    </div>
  );
}
