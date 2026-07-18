/**
 * Text excerpts the user selected in the page preview and attached to a
 * chat message. Stored as a custom `data-textQuotes` part so they persist
 * in history; the API also injects them into the agent instructions.
 */
export const TEXT_QUOTES_PART_TYPE = "data-textQuotes";

export const MAX_QUOTES_PER_MESSAGE = 6;
export const MAX_QUOTE_CHARS = 2_000;

export type TextQuote = {
  id: string;
  text: string;
  /** Heading of the section the selection came from, when known. */
  sectionHeading?: string;
};

export function normalizeQuoteText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
}

export function createTextQuote(
  text: string,
  sectionHeading?: string | null,
): TextQuote | null {
  const normalized = normalizeQuoteText(text);
  if (normalized.length < 2) return null;
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: normalized,
    ...(sectionHeading?.trim() ? { sectionHeading: sectionHeading.trim() } : {}),
  };
}

/** Appends quote parts to an existing message parts array. */
export function withTextQuoteParts<T extends { type: string }>(
  parts: T[],
  quotes: TextQuote[],
): Array<T | { type: typeof TEXT_QUOTES_PART_TYPE; data: TextQuote[] }> {
  if (quotes.length === 0) return parts;
  return [
    ...parts,
    {
      type: TEXT_QUOTES_PART_TYPE,
      data: quotes.map(({ id, text, sectionHeading }) => ({
        id,
        text,
        ...(sectionHeading ? { sectionHeading } : {}),
      })),
    },
  ];
}

export function quotesFromParts(parts: unknown[]): TextQuote[] {
  const out: TextQuote[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; data?: unknown };
    if (p.type !== TEXT_QUOTES_PART_TYPE || !Array.isArray(p.data)) continue;
    for (const item of p.data) {
      if (!item || typeof item !== "object") continue;
      const q = item as Record<string, unknown>;
      if (typeof q.text !== "string" || !q.text.trim()) continue;
      out.push({
        id: typeof q.id === "string" ? q.id : `q-${out.length}`,
        text: q.text,
        ...(typeof q.sectionHeading === "string"
          ? { sectionHeading: q.sectionHeading }
          : {}),
      });
    }
  }
  return out;
}
