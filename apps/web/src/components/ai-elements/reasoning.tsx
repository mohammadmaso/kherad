"use client";

import { cn } from "@kherad/ui/lib/utils";
import { BrainIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Response } from "@/components/ai-elements/response";

/**
 * Collapsible model-reasoning / thinking block. Starts open so streaming
 * thoughts are visible; the user can collapse anytime.
 */
export function Reasoning({
  text,
  state,
  label,
  className,
}: {
  text: string;
  state?: "streaming" | "done";
  label: string;
  className?: string;
}) {
  const streaming = state === "streaming";
  const [open, setOpen] = useState(true);

  if (!text.trim() && !streaming) return null;

  return (
    <div
      className={cn(
        "border-border bg-muted/20 my-1.5 overflow-hidden rounded-lg border text-xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 flex w-full items-center gap-2 px-2.5 py-1.5 text-start transition-colors duration-150 active:scale-[0.99]"
      >
        {streaming ? (
          <Loader2Icon className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : (
          <BrainIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-medium">{label}</span>
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open && text.trim() ? (
        <div className="border-border text-muted-foreground border-t px-2.5 py-2 text-sm italic">
          <Response className="[&_*]:text-muted-foreground">{text}</Response>
        </div>
      ) : null}
    </div>
  );
}
