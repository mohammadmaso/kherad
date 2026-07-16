import { decryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

export const OCR_SETTINGS_ID = "default";
export const DEFAULT_OCR_MODEL = "gpt-4o";

export type ResolvedOcrSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Loads dedicated OCR VLM settings. Returns null when unconfigured
 * (no row, missing base URL, or missing API key).
 */
export async function loadOcrSettings(db: Database): Promise<ResolvedOcrSettings | null> {
  const row = await db.query.ocrSettings.findFirst({
    where: eq(schema.ocrSettings.id, OCR_SETTINGS_ID),
  });
  if (!row?.apiKeyEnc || !row.baseUrl?.trim()) return null;

  let apiKey: string;
  try {
    apiKey = decryptRemoteToken(row.apiKeyEnc);
  } catch {
    return null;
  }

  return {
    baseUrl: row.baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: row.model?.trim() || DEFAULT_OCR_MODEL,
  };
}
