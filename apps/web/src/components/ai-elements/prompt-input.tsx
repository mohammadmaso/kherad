"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { cn } from "@kherad/ui/lib/utils";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

type PromptInputProps = {
  placeholder: string;
  submitLabel: string;
  stopLabel: string;
  /** "streaming"/"submitted" turn the send button into a stop button. */
  status: "ready" | "submitted" | "streaming" | "error";
  disabled?: boolean;
  className?: string;
  onSubmit: (text: string) => void;
  onStop: () => void;
};

/** Chat composer: Enter sends, Shift+Enter breaks the line, streaming swaps send for stop. */
export function PromptInput({
  placeholder,
  submitLabel,
  stopLabel,
  status,
  disabled,
  className,
  onSubmit,
  onStop,
}: PromptInputProps) {
  const [text, setText] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSubmit(trimmed);
    setText("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "border-border bg-background focus-within:border-ring flex items-end gap-2 rounded-xl border p-2 transition-colors duration-150",
        className,
      )}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="placeholder:text-muted-foreground max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none disabled:opacity-50"
      />
      {busy ? (
        <Button type="button" size="icon-sm" variant="outline" aria-label={stopLabel} onClick={onStop}>
          <SquareIcon className="size-3.5" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon-sm"
          aria-label={submitLabel}
          disabled={disabled || !text.trim()}
        >
          <ArrowUpIcon className="size-4" />
        </Button>
      )}
    </form>
  );
}
