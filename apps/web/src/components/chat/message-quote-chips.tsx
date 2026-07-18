"use client";

import { MessageSquareQuoteIcon } from "lucide-react";

import { quotesFromParts } from "@/components/chat/text-quotes";

/** Read-only chips shown on a sent message for preview excerpts it attached. */
export function MessageQuoteChips({ parts }: { parts: unknown[] }) {
  const quotes = quotesFromParts(parts);
  if (quotes.length === 0) return null;
  return (
    <div className="mb-1.5 flex min-w-0 max-w-full flex-col gap-1.5">
      {quotes.map((quote) => (
        <div
          key={quote.id}
          className="bg-primary/8 border-primary/20 text-foreground/90 flex w-full min-w-0 max-w-full items-start gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs"
          title={quote.text}
        >
          <MessageSquareQuoteIcon className="mt-0.5 size-3 shrink-0" />
          <div className="min-w-0 flex-1 overflow-hidden">
            {quote.sectionHeading ? (
              <p className="text-muted-foreground mb-0.5 truncate text-[0.65rem] font-medium tracking-[0.04em] uppercase">
                {quote.sectionHeading}
              </p>
            ) : null}
            <p className="line-clamp-3 break-words leading-relaxed" dir="auto">
              {quote.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
