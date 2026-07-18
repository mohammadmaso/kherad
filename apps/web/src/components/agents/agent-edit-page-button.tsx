"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createAgentSession } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

/** Wiki page header entry: open an edit-mode specialist session for this page. */
export function AgentEditPageButton({
  pageId,
  bundleId,
}: {
  pageId: string;
  bundleId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const session = await createAgentSession({
        mode: "edit",
        targetPageId: pageId,
        bundleId,
      });
      router.push(`/agents/${session.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void start()}
      className="active:scale-[0.97]"
    >
      <SparklesIcon className="size-3.5" />
      {busy ? t.common.loading : t.wiki.editWithAgent}
    </Button>
  );
}
