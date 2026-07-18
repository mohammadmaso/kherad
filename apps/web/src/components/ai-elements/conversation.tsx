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
      className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      initial="smooth"
      // Streaming appends resize the content many times per second; an animated
      // follow restarts on every resize and makes the pinned view jitter, so
      // follow instantly and keep "smooth" only for the initial scroll.
      resize="instant"
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
