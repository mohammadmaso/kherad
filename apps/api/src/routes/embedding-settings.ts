import { encryptRemoteToken, type GitEngine } from "@kherad/core/git";
import { reindexBundleSearch } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_SETTINGS_ID,
  loadEmbeddingSettings,
} from "../agents/embedding-settings";
import { createEmbedder } from "../lib/embedder";
import { requireAdmin } from "../plugins/auth";

type EmbeddingSettingsResponse = {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string;
  updatedAt: string | null;
  reindex: ReindexStatus;
};

type ReindexStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  finishedAt: string | null;
};

const reindexStatus: ReindexStatus = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  finishedAt: null,
};

function toResponse(
  row: typeof schema.embeddingSettings.$inferSelect | undefined,
): EmbeddingSettingsResponse {
  return {
    baseUrl: row?.baseUrl ?? null,
    hasApiKey: Boolean(row?.apiKeyEnc),
    model: row?.model ?? DEFAULT_EMBEDDING_MODEL,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    reindex: { ...reindexStatus },
  };
}

export async function embeddingSettingsRoutes(
  server: FastifyInstance,
  db: Database,
  git: GitEngine,
) {
  server.get("/admin/embedding-settings", { preHandler: requireAdmin() }, async () => {
    const row = await db.query.embeddingSettings.findFirst();
    return toResponse(row);
  });

  server.put<{
    Body: {
      baseUrl?: string | null;
      apiKey?: string;
      model?: string;
    };
  }>("/admin/embedding-settings", { preHandler: requireAdmin() }, async (request, reply) => {
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

    const existing = await db.query.embeddingSettings.findFirst();
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey && !existing?.apiKeyEnc) {
      return reply
        .code(400)
        .send({ error: "apiKey is required when first configuring embeddings" });
    }

    const nextModel = model?.trim() || DEFAULT_EMBEDDING_MODEL;
    const modelChanged = Boolean(existing?.model && existing.model !== nextModel);

    const values = {
      baseUrl: trimmedBaseUrl.replace(/\/+$/, ""),
      model: nextModel,
      ...(trimmedKey ? { apiKeyEnc: encryptRemoteToken(trimmedKey) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.embeddingSettings)
      .values({ id: EMBEDDING_SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: schema.embeddingSettings.id, set: values })
      .returning();

    if (modelChanged) {
      await db
        .delete(schema.pageEmbeddingChunks)
        .where(ne(schema.pageEmbeddingChunks.model, nextModel));
    }

    return { ...toResponse(row), modelChanged };
  });

  server.post(
    "/admin/embedding-settings/reindex",
    { preHandler: requireAdmin() },
    async (_request, reply) => {
      if (reindexStatus.running) {
        return reply.code(409).send({ error: "Reindex already running" });
      }

      const settings = await loadEmbeddingSettings(db);
      if (!settings) {
        return reply.code(409).send({ error: "Embeddings are not configured" });
      }

      const embedder = await createEmbedder(db);
      if (!embedder) {
        return reply.code(409).send({ error: "Embeddings are not configured" });
      }

      const bundles = await db.query.bundles.findMany({
        where: isNull(schema.bundles.archivedAt),
        columns: { id: true, slug: true, defaultBranch: true },
      });

      reindexStatus.running = true;
      reindexStatus.total = bundles.length;
      reindexStatus.done = 0;
      reindexStatus.failed = 0;
      reindexStatus.finishedAt = null;

      void (async () => {
        try {
          for (const bundle of bundles) {
            try {
              const result = await reindexBundleSearch(db, git, bundle, embedder);
              reindexStatus.failed += result.embedFailures;
            } catch (err) {
              server.log.error({ err, bundleId: bundle.id }, "embedding reindex bundle failed");
              reindexStatus.failed += 1;
            }
            reindexStatus.done += 1;
          }
        } finally {
          reindexStatus.running = false;
          reindexStatus.finishedAt = new Date().toISOString();
        }
      })();

      return { ...reindexStatus };
    },
  );
}
