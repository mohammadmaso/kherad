"use client";

import { FileTextIcon } from "lucide-react";

/**
 * Wiki-page mentions attached to a chat message. They ride on the user
 * message as a custom `data-pageMentions` part, so they persist in stored
 * message parts and replay losslessly from history. The API reads the same
 * part type (see apps/api/src/agents/page-mentions.ts) and injects the
 * pages' content into the agent's context.
 */
export const PAGE_MENTIONS_PART_TYPE = "data-pageMentions";

export type MentionPage = {
  bundleSlug: string;
  path: string;
  title: string;
  /** Shown when the picker spans several bundles. */
  bundleTitle?: string;
};

export const MAX_MENTIONS_PER_MESSAGE = 8;

/** Builds the parts array for a user message with optional page mentions. */
export function buildMentionMessageParts(
  text: string,
  mentions: MentionPage[],
): Array<
  | { type: "text"; text: string }
  | { type: typeof PAGE_MENTIONS_PART_TYPE; data: MentionPage[] }
> {
  return [
    { type: "text" as const, text },
    ...(mentions.length > 0
      ? [
          {
            type: PAGE_MENTIONS_PART_TYPE,
            data: mentions.map(({ bundleSlug, path, title }) => ({ bundleSlug, path, title })),
          } as const,
        ]
      : []),
  ];
}

/** Pulls page mentions back out of stored/streamed message parts. */
export function mentionsFromParts(parts: unknown[]): MentionPage[] {
  const out: MentionPage[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; data?: unknown };
    if (p.type !== PAGE_MENTIONS_PART_TYPE || !Array.isArray(p.data)) continue;
    for (const item of p.data) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      if (typeof m.bundleSlug !== "string" || typeof m.path !== "string") continue;
      out.push({
        bundleSlug: m.bundleSlug,
        path: m.path,
        title: typeof m.title === "string" && m.title ? m.title : m.path,
      });
    }
  }
  return out;
}

/** Read-only chips shown on a sent message for the pages it attached. */
export function MessageMentionChips({ parts }: { parts: unknown[] }) {
  const mentions = mentionsFromParts(parts);
  if (mentions.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {mentions.map((mention) => (
        <a
          key={`${mention.bundleSlug}:${mention.path}`}
          href={`/sources/${mention.bundleSlug}/${mention.path}`}
          target="_blank"
          rel="noreferrer"
          className="bg-background/60 border-border text-foreground/80 hover:text-foreground inline-flex max-w-56 items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors duration-150"
        >
          <FileTextIcon className="size-3 shrink-0" />
          <span className="truncate">{mention.title}</span>
        </a>
      ))}
    </div>
  );
}
