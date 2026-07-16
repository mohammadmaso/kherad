"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";

import type { PresenceEntry } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

export function SoftLockBanner({ entries }: { entries: PresenceEntry[] }) {
  const { t } = useI18n();
  if (entries.length === 0) return null;

  const names = entries.map((entry) => entry.displayName).join(", ");

  return (
    <Alert variant="warning">
      <AlertTitle>{t.editor.alsoEditing}</AlertTitle>
      <AlertDescription>{t.editor.alsoEditingBody(names, entries.length !== 1)}</AlertDescription>
    </Alert>
  );
}
