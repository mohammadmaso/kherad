"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useI18n } from "@/lib/i18n/provider";

/**
 * Bundle-scoped MR list used to live here, but the review queue lives under
 * `/admin/merge-requests` (admin chrome + cross-bundle view). Keep this route
 * as a redirect so old links and "back" navigation land on the styled page.
 */
export default function MergeRequestListRedirectPage() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    router.replace("/admin/merge-requests");
  }, [router, bundleId]);

  return <div className="text-muted-foreground p-8 text-sm">{t.common.loading}</div>;
}
