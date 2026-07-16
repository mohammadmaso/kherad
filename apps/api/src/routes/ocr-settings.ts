import { encryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import { DEFAULT_OCR_MODEL, OCR_SETTINGS_ID } from "../agents/ocr-settings";
import { requireAdmin, requireAuth } from "../plugins/auth";

type OcrSettingsResponse = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
};

function toResponse(row: typeof schema.ocrSettings.$inferSelect | undefined): OcrSettingsResponse {
  return {
    baseUrl: row?.baseUrl ?? null,
    hasApiKey: Boolean(row?.apiKeyEnc),
    model: row?.model ?? DEFAULT_OCR_MODEL,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function ocrSettingsRoutes(server: FastifyInstance, db: Database) {
  server.get("/admin/ocr-settings", { preHandler: requireAdmin() }, async () => {
    const row = await db.query.ocrSettings.findFirst();
    return toResponse(row);
  });

  /** Non-admin authors need to know whether OCR is available for the ingest UI. */
  server.get("/ingest/ocr-status", { preHandler: requireAuth() }, async () => {
    const row = await db.query.ocrSettings.findFirst();
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
  }>("/admin/ocr-settings", { preHandler: requireAdmin() }, async (request, reply) => {
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

    const existing = await db.query.ocrSettings.findFirst();
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey && !existing?.apiKeyEnc) {
      return reply.code(400).send({ error: "apiKey is required when first configuring OCR" });
    }

    const values = {
      baseUrl: trimmedBaseUrl.replace(/\/+$/, ""),
      model: model?.trim() || DEFAULT_OCR_MODEL,
      ...(trimmedKey ? { apiKeyEnc: encryptRemoteToken(trimmedKey) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.ocrSettings)
      .values({ id: OCR_SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: schema.ocrSettings.id, set: values })
      .returning();

    return toResponse(row);
  });
}
