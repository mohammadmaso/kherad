"use client";

import { Button } from "@kherad/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kherad/ui/components/ui/dialog";

import { useI18n } from "@/lib/i18n/provider";

export function RestoreDraftDialog({
  open,
  draftUpdatedAt,
  onRestore,
  onDiscard,
}: {
  open: boolean;
  draftUpdatedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t, locale } = useI18n();
  const when = new Date(draftUpdatedAt).toLocaleString(locale === "fa" ? "fa-IR" : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDiscard();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.editor.restoreTitle}</DialogTitle>
          <DialogDescription>{t.editor.restoreBody(when)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDiscard}>
            {t.editor.discard}
          </Button>
          <Button type="button" onClick={onRestore}>
            {t.editor.restoreDraft}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
