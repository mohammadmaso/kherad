"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { Textarea } from "@kherad/ui/components/ui/textarea";
import { PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { type OkfFrontmatter } from "@/lib/okf-frontmatter";
import { useI18n } from "@/lib/i18n/provider";

type ExtraRow = { key: string; value: string };

function extraToRows(extra: OkfFrontmatter["extra"]): ExtraRow[] {
  return Object.entries(extra).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(", ") : value,
  }));
}

function rowsToExtra(rows: ExtraRow[]): OkfFrontmatter["extra"] {
  const extra: OkfFrontmatter["extra"] = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) extra[key] = row.value;
  }
  return extra;
}

const inputSectionClass = "flex flex-col gap-1.5";
const labelClass = "text-muted-foreground text-xs font-medium";

/**
 * Structured editor for OKF front matter — the known fields
 * (`type`/`title`/`description`/`resource`/`tags`) plus a free-form
 * key/value list for anything else. `timestamp` is system-set on compile and
 * shown read-only. Callers own the round-trip with `serializeOkfFrontmatter`.
 *
 * `extra` rows keep their own local state rather than deriving straight from
 * `value.extra` every render: an in-progress row with an empty key has no
 * valid place in that record, so re-deriving from it would drop the row the
 * instant it's added. Pass a `resetToken` that changes when the caller wants
 * a clean resync (e.g. after restoring an autosaved draft) — this resyncs by
 * adjusting state during render rather than remounting via a changing `key`,
 * since a `key` swap on this component was observed to leave stale copies
 * behind instead of cleanly unmounting them.
 */
export function FrontmatterForm({
  value,
  onChange,
  resetToken,
}: {
  value: OkfFrontmatter;
  onChange: (next: OkfFrontmatter | null) => void;
  resetToken?: unknown;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ExtraRow[]>(() => extraToRows(value.extra));
  const [syncedResetToken, setSyncedResetToken] = useState(resetToken);

  if (resetToken !== syncedResetToken) {
    setSyncedResetToken(resetToken);
    setRows(extraToRows(value.extra));
  }

  function update(patch: Partial<OkfFrontmatter>) {
    onChange({ ...value, ...patch });
  }

  function commitRows(next: ExtraRow[]) {
    setRows(next);
    onChange({ ...value, extra: rowsToExtra(next) });
  }

  return (
    <section className="surface-card flex flex-col gap-5 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TagIcon className="text-primary size-4 shrink-0" />
          {t.frontmatter.title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onChange(null)}
        >
          {t.frontmatter.removeFrontmatter}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={inputSectionClass}>
          <Label htmlFor="fm-type" className={labelClass}>
            {t.frontmatter.typeLabel}
          </Label>
          <Input
            id="fm-type"
            value={value.type ?? ""}
            placeholder={t.frontmatter.typePlaceholder}
            onChange={(e) => update({ type: e.target.value || undefined })}
          />
        </div>
        <div className={inputSectionClass}>
          <Label htmlFor="fm-title" className={labelClass}>
            {t.frontmatter.titleLabel}
          </Label>
          <Input
            id="fm-title"
            value={value.title ?? ""}
            onChange={(e) => update({ title: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className={inputSectionClass}>
        <Label htmlFor="fm-description" className={labelClass}>
          {t.frontmatter.descriptionLabel}
        </Label>
        <Textarea
          id="fm-description"
          rows={2}
          value={value.description ?? ""}
          onChange={(e) => update({ description: e.target.value || undefined })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={inputSectionClass}>
          <Label htmlFor="fm-tags" className={labelClass}>
            {t.frontmatter.tagsLabel}
          </Label>
          <Input
            id="fm-tags"
            value={value.tags?.join(", ") ?? ""}
            placeholder={t.frontmatter.tagsHint}
            onChange={(e) => {
              const tags = e.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean);
              update({ tags: tags.length > 0 ? tags : undefined });
            }}
          />
        </div>
        <div className={inputSectionClass}>
          <Label htmlFor="fm-resource" className={labelClass}>
            {t.frontmatter.resourceLabel}
          </Label>
          <Input
            id="fm-resource"
            value={value.resource ?? ""}
            onChange={(e) => update({ resource: e.target.value || undefined })}
          />
        </div>
      </div>

      {value.timestamp ? (
        <p className="text-muted-foreground -mt-2 text-xs">
          {t.frontmatter.timestampLabel}: {value.timestamp}
        </p>
      ) : null}

      <div className="border-border flex flex-col gap-2.5 border-t pt-4">
        <Label className={labelClass}>{t.frontmatter.extraLabel}</Label>

        {rows.length > 0 ? (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="bg-muted/40 flex items-center gap-2 rounded-lg p-1.5">
                <Input
                  value={row.key}
                  placeholder={t.frontmatter.extraKeyPlaceholder}
                  onChange={(e) =>
                    commitRows(rows.map((r, ri) => (ri === i ? { ...r, key: e.target.value } : r)))
                  }
                  className="bg-background w-2/5 shrink-0"
                />
                <Input
                  value={row.value}
                  placeholder={t.frontmatter.extraValuePlaceholder}
                  onChange={(e) =>
                    commitRows(
                      rows.map((r, ri) => (ri === i ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  className="bg-background"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t.frontmatter.removeField}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => commitRows(rows.filter((_, ri) => ri !== i))}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-dashed"
          onClick={() => commitRows([...rows, { key: "", value: "" }])}
        >
          <PlusIcon className="size-3.5" />
          {t.frontmatter.addField}
        </Button>
      </div>
    </section>
  );
}
