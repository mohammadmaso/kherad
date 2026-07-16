"use client";

import { Badge } from "@kherad/ui/components/ui/badge";

import { useI18n } from "@/lib/i18n/provider";

export type SaveStatusValue = "saved" | "unsaved" | "saving" | "autosaving" | "autosaved";

export function SaveStatus({ status }: { status: SaveStatusValue }) {
  const { t } = useI18n();
  const labels: Record<SaveStatusValue, string> = {
    saved: t.editor.statusSaved,
    unsaved: t.editor.statusUnsaved,
    saving: t.editor.statusSaving,
    autosaving: t.editor.statusAutosaving,
    autosaved: t.editor.statusAutosaved,
  };
  const variant = status === "saved" ? "success" : status === "unsaved" ? "warning" : "secondary";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}
