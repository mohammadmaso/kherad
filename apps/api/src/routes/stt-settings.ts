import { encryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import { DEFAULT_STT_MODEL, STT_SETTINGS_ID } from "../agents/stt-settings";
import { requireAdmin, requireAuth } from "../plugins/auth";

type SttSettingsResponse = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
};

function toResponse(row: typeof schema.sttSettings.$inferSelect | undefined): SttSettingsResponse {
  return {
    baseUrl: row?.baseUrl ?? null,
    hasApiKey: Boolean(row?.apiKeyEnc),
    model: row?.model ?? DEFAULT_STT_MODEL,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function sttSettingsRoutes(server: FastifyInstance, db: Database) {
  server.get("/admin/stt-settings", { preHandler: requireAdmin() }, async () => {
    const row = await db.query.sttSettings.findFirst();
    return toResponse(row);
  });

  /** Non-admin authors need to know whether STT is available for voice ingest. */
  server.get("/ingest/stt-status", { preHandler: requireAuth() }, async () => {
    const row = await db.query.sttSettings.findFirst();
    return {
      configured: Boolean(row?.apiKeyEnc && row.baseUrl?.trim()),
    };
  });

  server.put<{
    Body: {
      baseUrl?: string | null;
      apiKey?: string;
      model?: string;
    };
  }>("/admin/stt-settings", { preHandler: requireAdmin() }, async (request, reply) => {
    const { baseUrl, apiKey, model } = request.body ?? {};

    const trimmedBaseUrl = baseUrl?.trim() || null;
    if (!trimmedBaseUrl) {
      return reply.code(400).send({ error: "baseUrl is required" });
    }
    try {
      new URL(trimmedBaseUrl);
    } catch {
      return reply.code(400).send({ error: "baseUrl must be a valid URL" });
    }

    const existing = await db.query.sttSettings.findFirst();
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey && !existing?.apiKeyEnc) {
      return reply.code(400).send({ error: "apiKey is required when first configuring STT" });
    }

    const values = {
      baseUrl: trimmedBaseUrl.replace(/\/+$/, ""),
      model: model?.trim() || DEFAULT_STT_MODEL,
      ...(trimmedKey ? { apiKeyEnc: encryptRemoteToken(trimmedKey) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.sttSettings)
      .values({ id: STT_SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: schema.sttSettings.id, set: values })
      .returning();

    return toResponse(row);
  });
}
