import { isValidVersionName, WikiVersionError, type GitEngine } from "@kherad/core/git";
import { reconcileOkfSearchIndex, reconcileRawPagesFromGit } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../plugins/auth";

/**
 * Whole-wiki version manager (admin-only). A version is a `version/<name>`
 * git branch snapshotting main; restore writes the snapshot tree back onto
 * main as one new commit (linear, non-destructive — the pre-restore state
 * stays in history) and then rebuilds page metadata + search for every
 * active bundle, since restored content bypasses the page CRUD routes.
 */
export async function wikiVersionRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  server.get("/admin/wiki-versions", { preHandler: requireAdmin() }, async () => {
    const versions = await git.listWikiVersions();
    return versions.map((version) => ({
      name: version.name,
      oid: version.oid,
      createdAt: version.createdAt.toISOString(),
    }));
  });

  // Candidate commits (main history) an admin can snapshot as a version.
  server.get<{ Querystring: { limit?: string } }>(
    "/admin/wiki-versions/commits",
    { preHandler: requireAdmin() },
    async (request) => {
      const parsed = Number.parseInt(request.query.limit ?? "", 10);
      const limit = Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 1), 200);
      const commits = await git.listWikiCommits(undefined, limit);
      return commits.map((commit) => ({
        oid: commit.oid,
        summary: commit.summary,
        authorName: commit.authorName,
        committedAt: commit.committedAt.toISOString(),
      }));
    },
  );

  server.post<{ Body: { name: string; fromOid?: string } }>(
    "/admin/wiki-versions",
    { preHandler: requireAdmin() },
    async (request, reply) => {
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
        const version = await git.createWikiVersion(
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

  server.post<{ Params: { name: string } }>(
    "/admin/wiki-versions/:name/restore",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const user = request.user!;
      let result;
      try {
        result = await git.restoreWikiVersion(request.params.name, {
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
        const bundles = await db.query.bundles.findMany({
          where: isNull(schema.bundles.archivedAt),
        });
        for (const bundle of bundles) {
          const raw = await reconcileRawPagesFromGit(db, git, bundle);
          pagesUpserted += raw.upserted;
          pagesDeleted += raw.deleted;
          await reconcileOkfSearchIndex(db, git, bundle);
        }
      }

      return { restored: result.restored, pagesUpserted, pagesDeleted };
    },
  );

  server.delete<{ Params: { name: string } }>(
    "/admin/wiki-versions/:name",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      try {
        await git.deleteWikiVersion(request.params.name);
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
