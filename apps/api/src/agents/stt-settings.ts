import { decryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

export const STT_SETTINGS_ID = "default";
export const DEFAULT_STT_MODEL = "whisper-1";

export type ResolvedSttSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Loads dedicated speech-to-text settings. Returns null when unconfigured
 * (no row, missing base URL, or missing API key).
 */
export async function loadSttSettings(db: Database): Promise<ResolvedSttSettings | null> {
  const row = await db.query.sttSettings.findFirst({
    where: eq(schema.sttSettings.id, STT_SETTINGS_ID),
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
    model: row.model?.trim() || DEFAULT_STT_MODEL,
  };
}
