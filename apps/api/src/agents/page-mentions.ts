import type { AuthedUser } from "@kherad/core/auth";
import { type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import type { UIMessage } from "ai";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Wiki pages the user attached to a chat message. The frontend sends them as
 * a custom `data-pageMentions` part on the user message, so they persist in
 * the stored parts and replay losslessly from history.
 */
export type PageMention = { bundleSlug: string; path: string; title?: string };

export const PAGE_MENTIONS_PART_TYPE = "data-pageMentions";

const MAX_MENTIONS = 8;
const MAX_CHARS_PER_PAGE = 20_000;

const decoder = new TextDecoder();

/**
 * Collects page mentions from every user message in the conversation (so an
 * attached page stays in context on follow-up turns), deduplicated, keeping
 * the most recent MAX_MENTIONS.
 */
export function extractPageMentions(messages: UIMessage[]): PageMention[] {
  const seen = new Map<string, PageMention>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; data?: unknown };
      if (p.type !== PAGE_MENTIONS_PART_TYPE || !Array.isArray(p.data)) continue;
      for (const item of p.data) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        if (typeof m.bundleSlug !== "string" || typeof m.path !== "string") continue;
        if (!m.bundleSlug || !m.path || m.path.length > 512) continue;
        const key = `${m.bundleSlug}:${m.path}`;
        seen.delete(key); // re-insert so the most recent mention orders last
        seen.set(key, {
          bundleSlug: m.bundleSlug,
          path: m.path,
          ...(typeof m.title === "string" ? { title: m.title } : {}),
        });
      }
    }
  }
  return [...seen.values()].slice(-MAX_MENTIONS);
}

/**
 * Reads the mentioned pages from git — permission-checked per page against
 * the requesting user — and renders them as an instructions block. Pages the
 * user cannot view (or that no longer exist) are silently skipped. Returns ""
 * when nothing is readable.
 */
export async function buildPageMentionContext(args: {
  db: Database;
  git: GitEngine;
  user: AuthedUser | null;
  mentions: PageMention[];
}): Promise<string> {
  const { db, git, user, mentions } = args;
  if (mentions.length === 0) return "";

  const sections: string[] = [];
  for (const mention of mentions) {
    const bundle = await db.query.bundles.findFirst({
      where: and(eq(schema.bundles.slug, mention.bundleSlug), isNull(schema.bundles.archivedAt)),
    });
    if (!bundle) continue;
    const allowed = await checkPermission(db, user, bundle, mention.path, "view");
    if (!allowed) continue;
    const bytes = await git.getLatestSourcePageAtRef(bundle.defaultBranch, bundle.slug, mention.path);
    if (bytes === null) continue;
    let content = decoder.decode(bytes);
    if (content.length > MAX_CHARS_PER_PAGE) {
      content = `${content.slice(0, MAX_CHARS_PER_PAGE)}\n\n[… truncated]`;
    }
    const heading = mention.title?.trim() || mention.path;
    sections.push(
      `### ${heading}\nBundle: "${bundle.title}" · Path: ${mention.path}\n\n${content}`,
    );
  }
  if (sections.length === 0) return "";

  return `\n\n## Wiki pages attached by the user

The user explicitly attached these wiki pages to the conversation. Treat them as primary context for their request — read them before answering, and prefer their content when it conflicts with your general recall.

${sections.join("\n\n---\n\n")}`;
}

export const TEXT_QUOTES_PART_TYPE = "data-textQuotes";

export type TextQuoteMention = { text: string; sectionHeading?: string };

const MAX_TEXT_QUOTES = 6;
const MAX_QUOTE_CHARS = 2_000;

/**
 * Collects text excerpts from the latest user message (selected in the page
 * preview and attached as `data-textQuotes` parts).
 */
export function extractTextQuotes(messages: UIMessage[]): TextQuoteMention[] {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return [];

  const out: TextQuoteMention[] = [];
  for (const part of lastUser.parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; data?: unknown };
    if (p.type !== TEXT_QUOTES_PART_TYPE || !Array.isArray(p.data)) continue;
    for (const item of p.data) {
      if (!item || typeof item !== "object") continue;
      const q = item as Record<string, unknown>;
      if (typeof q.text !== "string") continue;
      const text = q.text.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
      if (text.length < 2) continue;
      out.push({
        text,
        ...(typeof q.sectionHeading === "string" && q.sectionHeading.trim()
          ? { sectionHeading: q.sectionHeading.trim() }
          : {}),
      });
      if (out.length >= MAX_TEXT_QUOTES) return out;
    }
  }
  return out;
}

/** Renders selected preview excerpts as an instructions block. */
export function buildTextQuoteContext(quotes: TextQuoteMention[]): string {
  if (quotes.length === 0) return "";
  const blocks = quotes.map((q, i) => {
    const where = q.sectionHeading ? ` (section: "${q.sectionHeading}")` : "";
    return `${i + 1}.${where}\n> ${q.text}`;
  });
  return `\n\n## Excerpts the user selected from the page preview

The user highlighted these passages in the document they are editing. Treat them as the focus of their request.

${blocks.join("\n\n")}`;
}
