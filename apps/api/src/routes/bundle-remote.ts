import {
  decryptRemoteToken,
  encryptRemoteToken,
  RemotePullError,
  RemotePushError,
  type GitEngine,
} from "@kherad/core/git";
import { reconcileRawPagesFromGit } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { createEmbedder } from "../lib/embedder";
import { getBundleOrNull } from "../lib/get-bundle";
import { requireAdmin } from "../plugins/auth";

type BundleRemoteResponse = {
  connected: boolean;
  url: string | null;
  branch: string | null;
  hasToken: boolean;
  lastPushedAt: string | null;
  lastPushedOid: string | null;
  lastPulledAt: string | null;
  lastPulledOid: string | null;
  updatedAt: string | null;
};

function toResponse(
  row: typeof schema.bundleRemoteSettings.$inferSelect | undefined,
): BundleRemoteResponse {
  return {
    connected: Boolean(row),
    url: row?.url ?? null,
    branch: row?.branch ?? null,
    hasToken: Boolean(row?.tokenEnc),
    lastPushedAt: row?.lastPushedAt?.toISOString() ?? null,
    lastPushedOid: row?.lastPushedOid ?? null,
    lastPulledAt: row?.lastPulledAt?.toISOString() ?? null,
    lastPulledOid: row?.lastPulledOid ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Per-bundle git remote: push mirrors the bundle's source pages to an
 * external repo; pull replaces them with the remote's content. Admin-only —
 * pull writes straight to the bundle's default branch, bypassing MR review.
 */
export async function bundleRemoteRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  async function getRemoteRow(bundleId: string) {
    return db.query.bundleRemoteSettings.findFirst({
      where: eq(schema.bundleRemoteSettings.bundleId, bundleId),
    });
  }

  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/remote",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      return toResponse(await getRemoteRow(bundle.id));
    },
  );

  server.put<{
    Params: { bundleId: string };
    Body: { url: string; branch: string; token?: string };
  }>("/bundles/:bundleId/remote", { preHandler: requireAdmin() }, async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const { url, branch, token } = request.body;
    if (!url || !branch) {
      return reply.code(400).send({ error: "url and branch are required" });
    }
    if (!isHttpsUrl(url)) {
      return reply.code(400).send({ error: "Only HTTPS remote URLs are supported" });
    }

    const values = {
      url: url.trim(),
      branch: branch.trim() || "main",
      ...(token ? { tokenEnc: encryptRemoteToken(token.trim()) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.bundleRemoteSettings)
      .values({ bundleId: bundle.id, ...values })
      .onConflictDoUpdate({ target: schema.bundleRemoteSettings.bundleId, set: values })
      .returning();

    return toResponse(row);
  });

  server.delete<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/remote",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      await db
        .delete(schema.bundleRemoteSettings)
        .where(eq(schema.bundleRemoteSettings.bundleId, bundle.id));
      return toResponse(undefined);
    },
  );

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/remote/push",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const row = await getRemoteRow(bundle.id);
      if (!row) {
        return reply.code(400).send({ error: "No remote configured for this bundle" });
      }
      if (!row.tokenEnc) {
        return reply.code(400).send({ error: "An access token is required to push" });
      }

      let token: string;
      try {
        token = decryptRemoteToken(row.tokenEnc);
      } catch {
        return reply.code(500).send({ error: "Stored remote token could not be decrypted" });
      }

      let result;
      try {
        result = await git.pushBundleMirror(bundle.defaultBranch, bundle.slug, {
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
        return reply.code(409).send({ error: "This bundle has no committed pages to push yet" });
      }

      const [updated] = await db
        .update(schema.bundleRemoteSettings)
        .set({ lastPushedAt: new Date(), lastPushedOid: result.oid, updatedAt: new Date() })
        .where(eq(schema.bundleRemoteSettings.id, row.id))
        .returning();

      return { ...toResponse(updated), commitCount: result.commitCount };
    },
  );

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/remote/pull",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const row = await getRemoteRow(bundle.id);
      if (!row) {
        return reply.code(400).send({ error: "No remote configured for this bundle" });
      }

      let token: string | null = null;
      if (row.tokenEnc) {
        try {
          token = decryptRemoteToken(row.tokenEnc);
        } catch {
          return reply.code(500).send({ error: "Stored remote token could not be decrypted" });
        }
      }

      let result;
      try {
        result = await git.pullBundleSubtree(bundle.defaultBranch, bundle.slug, {
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

      // Pulled files bypass the page CRUD routes, so rebuild the pages
      // metadata + search index from the git tree.
      const pages = result.changed
        ? await reconcileRawPagesFromGit(db, git, bundle, await createEmbedder(db))
        : { upserted: 0, deleted: 0 };

      const [updated] = await db
        .update(schema.bundleRemoteSettings)
        .set({ lastPulledAt: new Date(), lastPulledOid: result.remoteOid, updatedAt: new Date() })
        .where(eq(schema.bundleRemoteSettings.id, row.id))
        .returning();

      return {
        ...toResponse(updated),
        changed: result.changed,
        pagesUpserted: pages.upserted,
        pagesDeleted: pages.deleted,
      };
    },
  );
}
