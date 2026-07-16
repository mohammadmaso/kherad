"use client";

import { useEffect, useState } from "react";

import { fetchAssetBlobUrl } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

function AssetPreview({ url, label }: { url: string | null; label: string }) {
  const { t } = useI18n();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchAssetBlobUrl(url)
      .then((resolved) => {
        if (cancelled) return;
        objectUrl = resolved;
        setBlobUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className="flex-1">
      <div className="text-muted-foreground mb-1.5 text-xs font-medium">{label}</div>
      <div className="border-border bg-muted/30 flex min-h-32 items-center justify-center rounded-lg border p-2">
        {!url ? (
          <span className="text-muted-foreground text-xs">{t.diff.none}</span>
        ) : error ? (
          <span className="text-destructive text-xs">{t.diff.loadFailed}</span>
        ) : blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={blobUrl} alt={label} className="max-h-64 max-w-full object-contain" />
        ) : (
          <span className="text-muted-foreground text-xs">{t.common.loading}</span>
        )}
      </div>
    </div>
  );
}

/** Side-by-side before/after preview for a changed binary image (PRD §7). */
export function ImageDiff({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string | null;
  afterUrl: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-3 p-3">
      <AssetPreview url={beforeUrl} label={t.diff.before} />
      <AssetPreview url={afterUrl} label={t.diff.after} />
    </div>
  );
}
