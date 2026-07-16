import { encryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import {
  AI_SETTINGS_ID,
  DEFAULT_CHAT_MODEL,
  DEFAULT_INDEXER_MODEL,
  type AiProvider,
} from "../agents/settings";
import { requireAdmin } from "../plugins/auth";

type AiSettingsResponse = {
  provider: AiProvider;
  baseUrl: string | null;
  // The key itself is write-only (same policy as bundle remote tokens).
  hasApiKey: boolean;
  indexerModel: string;
  chatModel: string;
  updatedAt: string | null;
};

function toResponse(row: typeof schema.aiSettings.$inferSelect | undefined): AiSettingsResponse {
  return {
    provider: row?.provider ?? "anthropic",
    baseUrl: row?.baseUrl ?? null,
    hasApiKey: Boolean(row?.apiKeyEnc),
    indexerModel: row?.indexerModel ?? DEFAULT_INDEXER_MODEL,
    chatModel: row?.chatModel ?? DEFAULT_CHAT_MODEL,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

function isProvider(value: unknown): value is AiProvider {
  return value === "anthropic" || value === "openai_compatible";
}

export async function aiSettingsRoutes(server: FastifyInstance, db: Database) {
  server.get("/admin/ai-settings", { preHandler: requireAdmin() }, async () => {
    const row = await db.query.aiSettings.findFirst();
    return toResponse(row);
  });

  server.put<{
    Body: {
      provider: AiProvider;
      baseUrl?: string | null;
      apiKey?: string;
      indexerModel?: string;
      chatModel?: string;
    };
  }>("/admin/ai-settings", { preHandler: requireAdmin() }, async (request, reply) => {
    const { provider, baseUrl, apiKey, indexerModel, chatModel } = request.body;

    if (!isProvider(provider)) {
      return reply.code(400).send({ error: "provider must be anthropic or openai_compatible" });
    }

    const trimmedBaseUrl = baseUrl?.trim() || null;
    if (provider === "openai_compatible" && !trimmedBaseUrl) {
      return reply.code(400).send({ error: "baseUrl is required for openai_compatible" });
    }
    if (trimmedBaseUrl) {
      try {
        new URL(trimmedBaseUrl);
      } catch {
        return reply.code(400).send({ error: "baseUrl must be a valid URL" });
      }
    }

    const existing = await db.query.aiSettings.findFirst();
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey && !existing?.apiKeyEnc) {
      return reply.code(400).send({ error: "apiKey is required when first configuring AI" });
    }

    const values = {
      provider,
      baseUrl: trimmedBaseUrl,
      indexerModel: indexerModel?.trim() || DEFAULT_INDEXER_MODEL,
      chatModel: chatModel?.trim() || DEFAULT_CHAT_MODEL,
      ...(trimmedKey ? { apiKeyEnc: encryptRemoteToken(trimmedKey) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.aiSettings)
      .values({ id: AI_SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: schema.aiSettings.id, set: values })
      .returning();

    return toResponse(row);
  });
}
