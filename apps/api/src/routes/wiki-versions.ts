import { isValidVersionName, WikiVersionError, type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { reconcileOkfSearchIndex, reconcileRawPagesFromGit } from "@kherad/core/search";
import type { Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import { createEmbedder } from "../lib/embedder";
import { getBundleOrNull } from "../lib/get-bundle";

/**
 * Per-bundle version manager (bundle managers + admins). A version is a
 * `version/<bundleSlug>/<name>` git branch snapshotting that bundle's
 * `raw/<slug>` subtree only; restore writes the snapshot tree back onto that
 * subtree on `main` as one new commit (linear, non-destructive — the
 * pre-restore state stays in history) and then rebuilds page metadata +
 * search for this bundle only, since restored content bypasses the page CRUD
 * routes.
 */
export async function wikiVersionRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/versions",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const versions = await git.listBundleWikiVersions(bundle.slug);
      return versions.map((version) => ({
        name: version.name,
        oid: version.oid,
        createdAt: version.createdAt.toISOString(),
      }));
    },
  );

  // Candidate commits (main history that touched this bundle) a manager can snapshot as a version.
  server.get<{ Params: { bundleId: string }; Querystring: { limit?: string } }>(
    "/bundles/:bundleId/versions/commits",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = Number.parseInt(request.query.limit ?? "", 10);
      const limit = Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 1), 200);
      const commits = await git.listBundleWikiCommits(bundle.slug, undefined, limit);
      return commits.map((commit) => ({
        oid: commit.oid,
        summary: commit.summary,
        authorName: commit.authorName,
        committedAt: commit.committedAt.toISOString(),
      }));
    },
  );

  server.post<{ Params: { bundleId: string }; Body: { name: string; fromOid?: string } }>(
    "/bundles/:bundleId/versions",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const name = request.body.name?.trim();
      if (!name || !isValidVersionName(name)) {
        return reply.code(400).send({
          error: "Version names may only contain letters, digits, dots, dashes and underscores",
        });
      }
      const fromOid = request.body.fromOid?.trim();
      if (fromOid !== undefined && fromOid !== "" && !/^[0-9a-f]{40}$/.test(fromOid)) {
        return reply.code(400).send({ error: "fromOid must be a full commit id" });
      }

      const user = request.user!;
      try {
        const version = await git.createBundleWikiVersion(
          bundle.slug,
          name,
          {
            name: user.displayName,
            email: user.email,
          },
          fromOid || undefined,
        );
        reply.code(201);
        return {
          name: version.name,
          oid: version.oid,
          createdAt: version.createdAt.toISOString(),
        };
      } catch (err) {
        if (err instanceof WikiVersionError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  server.post<{ Params: { bundleId: string; name: string } }>(
    "/bundles/:bundleId/versions/:name/restore",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const user = request.user!;
      let result;
      try {
        result = await git.restoreBundleWikiVersion(bundle.slug, request.params.name, {
          name: user.displayName,
          email: user.email,
        });
      } catch (err) {
        if (err instanceof WikiVersionError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }

      let pagesUpserted = 0;
      let pagesDeleted = 0;
      if (result.restored) {
        const embedder = await createEmbedder(db);
        const raw = await reconcileRawPagesFromGit(db, git, bundle, embedder);
        pagesUpserted = raw.upserted;
        pagesDeleted = raw.deleted;
        await reconcileOkfSearchIndex(db, git, bundle, embedder);
      }

      return { restored: result.restored, pagesUpserted, pagesDeleted };
    },
  );

  server.delete<{ Params: { bundleId: string; name: string } }>(
    "/bundles/:bundleId/versions/:name",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      try {
        await git.deleteBundleWikiVersion(bundle.slug, request.params.name);
      } catch (err) {
        if (err instanceof WikiVersionError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
      return { deleted: true };
    },
  );
}
