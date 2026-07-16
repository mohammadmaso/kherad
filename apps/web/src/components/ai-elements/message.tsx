"use client";

import { cn } from "@kherad/ui/lib/utils";
import type { ComponentProps } from "react";

type MessageProps = ComponentProps<"div"> & { from: "user" | "assistant" };

/** One chat turn: user turns sit at the end edge in a bubble, assistant turns fill the line. */
export function Message({ from, className, ...props }: MessageProps) {
  return (
    <div
      data-role={from}
      className={cn("flex w-full", from === "user" ? "justify-end" : "justify-start", className)}
      {...props}
    />
  );
}

export function MessageContent({
  from,
  className,
  ...props
}: ComponentProps<"div"> & { from: "user" | "assistant" }) {
  return (
    <div
      className={cn(
        "max-w-[85%] text-sm leading-relaxed",
        from === "user"
          ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md px-3.5 py-2"
          : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}
