import { decryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

export const EMBEDDING_SETTINGS_ID = "default";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export type ResolvedEmbeddingSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Loads dedicated embedding settings. Returns null when unconfigured
 * (no row, missing base URL, or missing API key).
 */
export async function loadEmbeddingSettings(
  db: Database,
): Promise<ResolvedEmbeddingSettings | null> {
  const row = await db.query.embeddingSettings.findFirst({
    where: eq(schema.embeddingSettings.id, EMBEDDING_SETTINGS_ID),
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
    model: row.model?.trim() || DEFAULT_EMBEDDING_MODEL,
  };
}
