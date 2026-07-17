"use client";

import { cn } from "@kherad/ui/lib/utils";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Response } from "@/components/ai-elements/response";

type MessagePart = UIMessage["parts"][number];

const FRIENDLY_NAMES: Record<string, string> = {
  read_index: "Read index",
  list_docs: "List documents",
  read_doc: "Read document",
  semantic_search: "Semantic search",
  find_docs_by_metadata: "Find by metadata",
  list_bundles: "List bundles",
  list_source_pages: "List pages",
  read_source_page: "Read page",
  list_uploads: "List uploads",
  read_upload: "Read upload",
  ask_question: "Ask question",
  propose_document: "Propose document",
};

function friendlyToolName(name: string): string {
  return FRIENDLY_NAMES[name] ?? name.replaceAll("_", " ");
}

function isRunning(state: string | undefined): boolean {
  return state === "input-streaming" || state === "input-available";
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Markdown fields that structured tools may carry — render with Streamdown. */
function extractMarkdownFields(value: unknown): Array<{ label: string; markdown: string }> {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const out: Array<{ label: string; markdown: string }> = [];
  if (typeof obj.prompt === "string" && obj.prompt.trim()) {
    out.push({ label: "Prompt", markdown: obj.prompt });
  }
  if (typeof obj.markdown === "string" && obj.markdown.trim()) {
    out.push({ label: "Document", markdown: obj.markdown });
  }
  if (typeof obj.content === "string" && obj.content.trim() && obj.content.includes("\n")) {
    out.push({ label: "Content", markdown: obj.content });
  }
  return out;
}

/**
 * Collapsible tool-call chip: status, name, optional input/output.
 * Structured markdown fields (prompt, markdown, content) render via Streamdown.
 */
export function ToolCall({
  part,
  defaultOpen = false,
  className,
}: {
  part: MessagePart;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!isToolUIPart(part)) return null;

  const name = getToolName(part);
  const state = part.state;
  const running = isRunning(state);
  const errored = state === "output-error";
  const done = state === "output-available";

  const input = "input" in part ? part.input : undefined;
  const output = done && "output" in part ? part.output : undefined;
  const errorText =
    errored && "errorText" in part && typeof part.errorText === "string" ? part.errorText : null;

  const markdownBlocks = [
    ...extractMarkdownFields(input),
    ...(done ? extractMarkdownFields(output) : []),
  ];

  const hasStructuredMd = markdownBlocks.some(
    (b) => b.label === "Prompt" || b.label === "Document",
  );
  const showInputJson = input !== undefined && !hasStructuredMd;

  return (
    <div
      className={cn(
        "border-border bg-muted/25 my-1.5 overflow-hidden rounded-lg border text-xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 flex w-full items-center gap-2 px-2.5 py-1.5 text-start transition-colors duration-150 active:scale-[0.99]"
      >
        {running ? (
          <Loader2Icon className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : errored ? (
          <XIcon className="text-destructive size-3.5 shrink-0" />
        ) : done ? (
          <CheckIcon className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <WrenchIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{friendlyToolName(name)}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {running ? "…" : errored ? "error" : done ? "done" : state}
        </span>
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {open ? (
        <div className="border-border space-y-2 border-t px-2.5 py-2">
          {markdownBlocks.map((block) => (
            <div key={block.label} className="space-y-1">
              <p className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
                {block.label}
              </p>
              <Response className="text-sm">{block.markdown}</Response>
            </div>
          ))}
          {showInputJson ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
                Input
              </p>
              <pre
                className="bg-background/60 max-h-40 overflow-auto rounded-md p-2 font-mono text-[0.7rem] leading-relaxed"
                dir="ltr"
              >
                {formatJson(input)}
              </pre>
            </div>
          ) : null}
          {done && output !== undefined && !hasStructuredMd && markdownBlocks.length === 0 ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
                Output
              </p>
              <pre
                className="bg-background/60 max-h-48 overflow-auto rounded-md p-2 font-mono text-[0.7rem] leading-relaxed"
                dir="ltr"
              >
                {formatJson(output)}
              </pre>
            </div>
          ) : null}
          {errored && errorText ? (
            <p className="text-destructive text-xs">{errorText}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function isAskQuestionToolPart(part: MessagePart): boolean {
  if (!isToolUIPart(part)) return false;
  return getToolName(part) === "ask_question";
}
