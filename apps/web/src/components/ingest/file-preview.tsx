"use client";

import { FileIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/provider";
import { formatBytes } from "./ingest-format";

type PreviewKind = "text" | "html" | "docx" | "spreadsheet" | "unsupported";

type PreviewState =
  | { status: "loading" }
  | { status: "text"; content: string }
  | { status: "html"; content: string }
  | { status: "error" }
  | { status: "unsupported" };

function kindFor(name: string): PreviewKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "txt") return "text";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "doc" || ext === "docx") return "docx";
  if (ext === "xls" || ext === "xlsx") return "spreadsheet";
  return "unsupported";
}

function FormatIcon({ format }: { format: string }) {
  if (format === "xls" || format === "xlsx") return <FileSpreadsheetIcon className="size-5" />;
  if (["md", "txt", "html", "htm", "doc", "docx"].includes(format))
    return <FileTextIcon className="size-5" />;
  return <FileIcon className="size-5" />;
}

/** Client-side preview for source files Docling doesn't rasterize into page images. */
export function FilePreview({
  file,
  filename,
  format,
}: {
  file: File;
  filename: string;
  format: string;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ file: File; state: PreviewState } | null>(null);
  const state: PreviewState = result?.file === file ? result.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    const kind = kindFor(file.name);

    (async () => {
      try {
        if (kind === "text") {
          const content = await file.text();
          if (!cancelled) setResult({ file, state: { status: "text", content } });
          return;
        }
        if (kind === "html") {
          const content = await file.text();
          if (!cancelled) setResult({ file, state: { status: "html", content } });
          return;
        }
        if (kind === "docx") {
          const [{ convertToHtml }, buffer] = await Promise.all([
            import("mammoth"),
            file.arrayBuffer(),
          ]);
          const converted = await convertToHtml({ arrayBuffer: buffer });
          if (!cancelled) setResult({ file, state: { status: "html", content: converted.value } });
          return;
        }
        if (kind === "spreadsheet") {
          const [xlsxModule, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
          const workbook = xlsxModule.read(new Uint8Array(buffer), { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) throw new Error("empty workbook");
          const sheet = workbook.Sheets[firstSheetName];
          if (!sheet) throw new Error("missing sheet");
          const html = xlsxModule.utils.sheet_to_html(sheet);
          if (!cancelled) setResult({ file, state: { status: "html", content: html } });
          return;
        }
        if (!cancelled) setResult({ file, state: { status: "unsupported" } });
      } catch {
        if (!cancelled) setResult({ file, state: { status: "error" } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  if (state.status === "loading") {
    return <p className="text-muted-foreground text-sm">{t.ingest.previewLoading}</p>;
  }

  if (state.status === "text") {
    return (
      <pre
        dir="auto"
        className="text-foreground max-h-full overflow-auto whitespace-pre-wrap font-mono text-xs"
      >
        {state.content}
      </pre>
    );
  }

  if (state.status === "html") {
    const kind = kindFor(file.name);
    return (
      <div className="flex flex-col gap-2">
        {kind === "html" ? (
          <p className="text-muted-foreground text-xs">{t.ingest.previewHtmlNotice}</p>
        ) : null}
        {kind === "spreadsheet" ? (
          <p className="text-muted-foreground text-xs">{t.ingest.previewSpreadsheetNotice}</p>
        ) : null}
        {kind === "html" ? (
          <iframe
            title={filename}
            sandbox=""
            srcDoc={state.content}
            className="border-border bg-background h-[28rem] w-full rounded-md border"
          />
        ) : (
          <div
            dir="auto"
            className="[&_td]:border-border [&_th]:border-border [&_th]:bg-muted/40 max-w-none overflow-auto text-sm leading-relaxed [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-medium [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-2 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:p-1.5 [&_th]:border [&_th]:p-1.5 [&_th]:font-medium [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5"
            dangerouslySetInnerHTML={{ __html: state.content }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
        <FormatIcon format={format} />
      </span>
      <p className="text-muted-foreground text-sm">
        {state.status === "error" ? t.ingest.previewFailed : t.ingest.previewNoVisual}
      </p>
      <p className="text-muted-foreground max-w-xs text-xs">{t.ingest.editMarkdownHint}</p>
      <p className="text-muted-foreground font-mono text-xs" dir="auto">
        {filename} · {formatBytes(file.size)}
      </p>
    </div>
  );
}
