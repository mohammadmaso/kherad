"use client";

import { cn } from "@kherad/ui/lib/utils";
import { diffLines } from "diff";
import { MessageSquarePlus } from "lucide-react";
import { Fragment } from "react";

import { useI18n } from "@/lib/i18n/provider";

type DiffRow = {
  type: "add" | "remove" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

/** Raw line-based diff (PRD §7: "not rendered-HTML diff"), built on jsdiff. */
function computeLineDiff(before: string, after: string): DiffRow[] {
  const parts = diffLines(before, after);
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    for (const text of lines) {
      if (part.added) {
        rows.push({ type: "add", text, oldLine: null, newLine });
        newLine++;
      } else if (part.removed) {
        rows.push({ type: "remove", text, oldLine, newLine: null });
        oldLine++;
      } else {
        rows.push({ type: "context", text, oldLine, newLine });
        oldLine++;
        newLine++;
      }
    }
  }
  return rows;
}

export function DiffView({
  path,
  before,
  after,
  onCommentOnLine,
}: {
  path: string;
  before: string | null;
  after: string | null;
  onCommentOnLine?: (path: string, line: number) => void;
}) {
  const { t } = useI18n();
  const rows = computeLineDiff(before ?? "", after ?? "");

  if (rows.length === 0) {
    return <p className="text-muted-foreground px-3 py-4 text-sm">{t.mr.noTextualChanges}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-b-lg">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {rows.map((row, index) => {
            const commentLine = row.newLine ?? row.oldLine;
            return (
              <Fragment key={index}>
                <tr
                  className={cn(
                    "group",
                    row.type === "add" && "bg-emerald-500/10",
                    row.type === "remove" && "bg-red-500/10",
                  )}
                >
                  <td className="border-border text-muted-foreground w-10 shrink-0 select-none border-e px-2 py-0.5 text-end">
                    {row.oldLine ?? ""}
                  </td>
                  <td className="border-border text-muted-foreground w-10 shrink-0 select-none border-e px-2 py-0.5 text-end">
                    {row.newLine ?? ""}
                  </td>
                  <td
                    className={cn(
                      "w-4 shrink-0 select-none px-1 py-0.5 text-center",
                      row.type === "add" && "text-emerald-700 dark:text-emerald-400",
                      row.type === "remove" && "text-red-700 dark:text-red-400",
                    )}
                  >
                    {row.type === "add" ? "+" : row.type === "remove" ? "−" : ""}
                  </td>
                  <td className="whitespace-pre px-2 py-0.5">{row.text || " "}</td>
                  <td className="w-8 px-1 py-0.5 text-end">
                    {onCommentOnLine && commentLine !== null ? (
                      <button
                        type="button"
                        onClick={() => onCommentOnLine(path, commentLine)}
                        className="text-muted-foreground hover:text-foreground invisible group-hover:visible"
                        aria-label={t.mr.commentOnLineAria(commentLine)}
                      >
                        <MessageSquarePlus className="size-3.5" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
