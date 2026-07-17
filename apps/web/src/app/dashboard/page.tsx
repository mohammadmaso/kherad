"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchMyBundles, getToken, hasValidSession, type MyBundle } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const ROLE_BADGE_VARIANT: Record<MyBundle["role"], "default" | "secondary" | "outline"> = {
  manager: "default",
  author: "secondary",
  viewer: "outline",
};

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [bundles, setBundles] = useState<MyBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getToken()) {
        if (!cancelled) router.replace("/login?next=/dashboard");
        return;
      }

      if (!(await hasValidSession())) {
        if (!cancelled) router.replace("/login?next=/dashboard");
        return;
      }

      try {
        const rows = await fetchMyBundles();
        if (!cancelled) setBundles(rows);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.dashboard.loadErrorFallback);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1>{t.dashboard.title}</h1>
        <p className="text-muted-foreground text-sm">{t.dashboard.subtitle}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.dashboard.loadErrorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {bundles === null ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : bundles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.dashboard.empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {bundles.map((bundle) => (
            <Link
              key={bundle.id}
              href={`/wiki/${bundle.slug}`}
              className="surface-card surface-card-interactive flex flex-col gap-2 rounded-xl p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" dir="auto">
                  {bundle.title}
                </span>
                <Badge variant={ROLE_BADGE_VARIANT[bundle.role]}>
                  {t.dashboard.role[bundle.role]}
                </Badge>
              </div>
              <span dir="ltr" className="text-muted-foreground text-start font-mono text-xs">
                {bundle.slug}
              </span>
              {bundle.isPublic ? (
                <Badge variant="success" className="w-fit text-[0.65rem]">
                  {t.dashboard.publicBadge}
                </Badge>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
