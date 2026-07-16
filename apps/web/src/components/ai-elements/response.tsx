"use client";

import { cn } from "@kherad/ui/lib/utils";
import { memo } from "react";
import { Streamdown } from "streamdown";

type ResponseProps = { children: string; className?: string };

/**
 * Streaming-safe markdown for assistant turns (AI Elements' Response =
 * Streamdown): renders incomplete markdown gracefully mid-stream. Memoized so
 * finished messages don't re-render on every incoming token.
 */
export const Response = memo(
  function Response({ children, className }: ResponseProps) {
    return (
      <Streamdown
        className={cn("[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2", className)}
      >
        {children}
      </Streamdown>
    );
  },
  (prev, next) => prev.children === next.children && prev.className === next.className,
);
