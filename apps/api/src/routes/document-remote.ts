import {
  decryptRemoteToken,
  encryptRemoteToken,
  RemotePullError,
  RemotePushError,
  DEFAULT_BRANCH,
  DOCUMENTS_GIT_PATH_PREFIX,
  type GitEngine,
} from "@kherad/core/git";
import { reconcileOkfSearchIndex } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { createEmbedder } from "../lib/embedder";
import { requireAdmin } from "../plugins/auth";

export const DOCUMENT_REMOTE_SETTINGS_ID = "default";

type DocumentRemoteResponse = {
  connected: boolean;
  url: string | null;
  branch: string | null;
  lastPushedAt: string | null;
  lastPushedOid: string | null;
  lastPulledAt: string | null;
  lastPulledOid: string | null;
  updatedAt: string | null;
};

function toResponse(
  row: typeof schema.documentRemoteSettings.$inferSelect | undefined,
): DocumentRemoteResponse {
  return {
    connected: Boolean(row?.url),
    url: row?.url ?? null,
    branch: row?.branch ?? null,
    lastPushedAt: row?.lastPushedAt?.toISOString() ?? null,
    lastPushedOid: row?.lastPushedOid ?? null,
    lastPulledAt: row?.lastPulledAt?.toISOString() ?? null,
    lastPulledOid: row?.lastPulledOid ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

function titleFromSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function documentRemoteRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  server.get("/admin/document-remote", { preHandler: requireAdmin() }, async () => {
    const row = await db.query.documentRemoteSettings.findFirst({
      where: eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID),
    });
    return toResponse(row);
  });

  server.put<{
    Body: { url: string; branch: string; token?: string };
  }>("/admin/document-remote", { preHandler: requireAdmin() }, async (request, reply) => {
    const { url, branch, token } = request.body;
    if (!url || !branch) {
      return reply.code(400).send({ error: "url and branch are required" });
    }
    if (!isHttpsUrl(url)) {
      return reply.code(400).send({ error: "Only HTTPS remote URLs are supported" });
    }

    const existing = await db.query.documentRemoteSettings.findFirst({
      where: eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID),
    });
    if (!token && !existing?.tokenEnc) {
      return reply.code(400).send({ error: "token is required when first connecting a remote" });
    }

    const values = {
      url: url.trim(),
      branch: branch.trim() || "main",
      ...(token ? { tokenEnc: encryptRemoteToken(token.trim()) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.documentRemoteSettings)
      .values({ id: DOCUMENT_REMOTE_SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: schema.documentRemoteSettings.id, set: values })
      .returning();

    return toResponse(row);
  });

  server.delete("/admin/document-remote", { preHandler: requireAdmin() }, async () => {
    const [row] = await db
      .insert(schema.documentRemoteSettings)
      .values({ id: DOCUMENT_REMOTE_SETTINGS_ID })
      .onConflictDoUpdate({
        target: schema.documentRemoteSettings.id,
        set: {
          url: null,
          branch: null,
          tokenEnc: null,
          lastPushedAt: null,
          lastPushedOid: null,
          lastPulledAt: null,
          lastPulledOid: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return toResponse(row);
  });

  server.post("/admin/document-remote/push", { preHandler: requireAdmin() }, async (request, reply) => {
    const row = await db.query.documentRemoteSettings.findFirst({
      where: eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID),
    });
    if (!row?.url || !row.branch || !row.tokenEnc) {
      return reply.code(400).send({ error: "No document remote configured" });
    }

    let token: string;
    try {
      token = decryptRemoteToken(row.tokenEnc);
    } catch {
      return reply.code(500).send({ error: "Stored remote token could not be decrypted" });
    }

    let result;
    try {
      result = await git.pushDocumentsMirror(DEFAULT_BRANCH, {
        url: row.url,
        branch: row.branch,
        token,
      });
    } catch (err) {
      if (err instanceof RemotePushError) {
        return reply.code(502).send({ error: err.message });
      }
      throw err;
    }

    if (!result.pushed) {
      return reply.code(409).send({ error: "No compiled documents to push yet" });
    }

    const [updated] = await db
      .update(schema.documentRemoteSettings)
      .set({ lastPushedAt: new Date(), lastPushedOid: result.oid, updatedAt: new Date() })
      .where(eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID))
      .returning();

    return { ...toResponse(updated), commitCount: result.commitCount };
  });

  // Inverse of push: replaces the whole `okf/` tree with the remote's content
  // (admin-only, bypasses MR review). Bundles that exist on the remote but not
  // locally are created so the pulled documents are visible and searchable.
  server.post("/admin/document-remote/pull", { preHandler: requireAdmin() }, async (_, reply) => {
    const row = await db.query.documentRemoteSettings.findFirst({
      where: eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID),
    });
    if (!row?.url || !row.branch || !row.tokenEnc) {
      return reply.code(400).send({ error: "No document remote configured" });
    }

    let token: string;
    try {
      token = decryptRemoteToken(row.tokenEnc);
    } catch {
      return reply.code(500).send({ error: "Stored remote token could not be decrypted" });
    }

    let result;
    try {
      result = await git.pullDocumentsFromRemote(DEFAULT_BRANCH, {
        url: row.url,
        branch: row.branch,
        token,
      });
    } catch (err) {
      if (err instanceof RemotePullError) {
        return reply.code(502).send({ error: err.message });
      }
      throw err;
    }

    let createdBundles = 0;
    if (result.changed) {
      // Every top-level folder under okf/ is a bundle slug on the remote.
      const remoteSlugs = new Set(
        (await git.listFilesAtRef(DEFAULT_BRANCH, DOCUMENTS_GIT_PATH_PREFIX))
          .map((gitPath) => gitPath.split("/")[1])
          .filter((slug): slug is string => Boolean(slug)),
      );
      const bundles = await db.query.bundles.findMany();
      const knownSlugs = new Set(bundles.map((bundle) => bundle.slug));

      for (const slug of remoteSlugs) {
        if (knownSlugs.has(slug)) continue;
        await db
          .insert(schema.bundles)
          .values({ slug, title: titleFromSlug(slug), isPublic: false, mode: "llm_compiled" })
          .onConflictDoNothing({ target: schema.bundles.slug });
        createdBundles += 1;
      }

      // Full reconcile for every active bundle: pull is an exact mirror, so
      // bundles absent from the remote just lost their okf tree — their rows
      // are dropped by the same pass.
      const activeBundles = await db.query.bundles.findMany({
        where: isNull(schema.bundles.archivedAt),
      });
      const embedder = await createEmbedder(db);
      for (const bundle of activeBundles) {
        await reconcileOkfSearchIndex(db, git, bundle, embedder);
      }
    }

    const [updated] = await db
      .update(schema.documentRemoteSettings)
      .set({ lastPulledAt: new Date(), lastPulledOid: result.remoteOid, updatedAt: new Date() })
      .where(eq(schema.documentRemoteSettings.id, DOCUMENT_REMOTE_SETTINGS_ID))
      .returning();

    return { ...toResponse(updated), changed: result.changed, createdBundles };
  });
}
