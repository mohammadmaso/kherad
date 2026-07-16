"use client";

import { Button } from "@kherad/ui/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { hasValidSession } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (await hasValidSession()) {
        if (!cancelled) router.replace("/dashboard");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_35%,color-mix(in_oklch,var(--primary),transparent_92%),transparent)]"
      />
      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.08em]">
          {t.home.kicker}
        </span>
        <h1 className="text-display">{t.common.appName}</h1>
        <p className="text-muted-foreground max-w-md text-pretty text-base">{t.home.description}</p>
        <Button size="lg" className="mt-2" nativeButton={false} render={<Link href="/dashboard" />}>
          {t.home.cta}
        </Button>
      </div>
    </div>
  );
}
