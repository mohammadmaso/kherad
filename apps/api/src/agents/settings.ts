import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { decryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

export const AI_SETTINGS_ID = "default";
export const DEFAULT_INDEXER_MODEL = "claude-opus-4-8";
export const DEFAULT_CHAT_MODEL = "claude-sonnet-5";

export type AiProvider = (typeof schema.aiProviderEnum.enumValues)[number];

export type ResolvedAiSettings = {
  provider: AiProvider;
  baseUrl: string | null;
  apiKey: string;
  indexerModel: string;
  chatModel: string;
};

/**
 * Loads and decrypts the singleton AI configuration. Returns null when the
 * feature is unconfigured (no row or no API key) — callers surface that as
 * a 503 rather than letting an agent run fail mid-flight.
 */
export async function loadAiSettings(db: Database): Promise<ResolvedAiSettings | null> {
  const row = await db.query.aiSettings.findFirst({
    where: eq(schema.aiSettings.id, AI_SETTINGS_ID),
  });
  if (!row?.apiKeyEnc) return null;

  let apiKey: string;
  try {
    apiKey = decryptRemoteToken(row.apiKeyEnc);
  } catch {
    return null;
  }

  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey,
    indexerModel: row.indexerModel,
    chatModel: row.chatModel,
  };
}

/**
 * Builds the AI SDK model instance both Mastra agents run on. Settings come
 * from Postgres (admin-editable), so the provider is constructed per call —
 * never from environment variables.
 */
export function buildModel(settings: ResolvedAiSettings, which: "indexer" | "chat" | "interviewer") {
  const modelId =
    which === "indexer" ? settings.indexerModel : settings.chatModel;

  if (settings.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
    });
    return anthropic(modelId);
  }

  // openai_compatible requires an explicit base URL (validated at PUT time).
  const provider = createOpenAICompatible({
    name: "custom",
    baseURL: settings.baseUrl ?? "",
    apiKey: settings.apiKey,
  });
  return provider(modelId);
}
