"use client";

import { cn } from "@kherad/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

/**
 * Scrollable message area that follows the streaming response (AI Elements'
 * Conversation pattern, built on the same use-stick-to-bottom primitive).
 */
export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-auto", className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export function ConversationContent({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children: React.ReactNode }) {
  return (
    <StickToBottom.Content className={cn("flex flex-col gap-4 p-4", className)} {...props}>
      {children}
    </StickToBottom.Content>
  );
}

/** Appears when the reader scrolls up during a stream; returns them to the tail. */
export function ConversationScrollButton({ label }: { label: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => scrollToBottom()}
      className="border-border bg-background/80 text-muted-foreground hover:text-foreground absolute bottom-3 start-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors duration-150 rtl:translate-x-1/2"
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}
