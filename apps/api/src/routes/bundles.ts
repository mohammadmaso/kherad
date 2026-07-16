import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { isUniqueViolation } from "../lib/db-errors";
import { getBundleOrNull } from "../lib/get-bundle";
import { requireAdmin } from "../plugins/auth";

type PermissionRole = (typeof schema.permissionRoleEnum.enumValues)[number];

// The slug is the join key into the git tree (`raw/<slug>/…`, `okf/<slug>/…`),
// so it must stay a single safe path segment — no slashes, dots, or spaces.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Presentational only (which badge to show on the dashboard) — every actual
// access decision still goes through `checkPermission`.
const ROLE_RANK: Record<PermissionRole, number> = { viewer: 1, author: 2, manager: 3 };

export async function bundleRoutes(server: FastifyInstance, db: Database) {
  // Admin-only listing (incl. archived bundles) for the admin panel's bundle table.
  server.get("/bundles", { preHandler: requireAdmin() }, async () => {
    return db.query.bundles.findMany({ orderBy: (b, { asc }) => asc(b.slug) });
  });

  // Every non-archived bundle the caller can at least view — the "my
  // documents" dashboard for signed-in users, and just the public bundles
  // (PRD: public bundles allow anonymous view) for anonymous visitors.
  server.get("/bundles/mine", async (request) => {
    const user = request.user;

    if (!user) {
      const publicBundles = await db.query.bundles.findMany({
        where: and(eq(schema.bundles.isPublic, true), isNull(schema.bundles.archivedAt)),
        orderBy: (b, { asc }) => asc(b.title),
      });
      return publicBundles.map((bundle) => ({ ...bundle, role: "viewer" as const }));
    }

    if (user.isAdmin) {
      const all = await db.query.bundles.findMany({
        where: isNull(schema.bundles.archivedAt),
        orderBy: (b, { asc }) => asc(b.title),
      });
      return all.map((bundle) => ({ ...bundle, role: "manager" as const }));
    }

    const [grants, publicBundles] = await Promise.all([
      db.query.permissions.findMany({
        where: eq(schema.permissions.userId, user.id),
        with: { bundle: true },
      }),
      db.query.bundles.findMany({
        where: and(eq(schema.bundles.isPublic, true), isNull(schema.bundles.archivedAt)),
      }),
    ]);

    const byBundleId = new Map<
      string,
      { bundle: typeof schema.bundles.$inferSelect; role: PermissionRole }
    >();
    for (const grant of grants) {
      if (grant.bundle.archivedAt) continue;
      const existing = byBundleId.get(grant.bundleId);
      if (!existing || ROLE_RANK[grant.role] > ROLE_RANK[existing.role]) {
        byBundleId.set(grant.bundleId, { bundle: grant.bundle, role: grant.role });
      }
    }
    for (const bundle of publicBundles) {
      if (!byBundleId.has(bundle.id)) {
        byBundleId.set(bundle.id, { bundle, role: "viewer" });
      }
    }

    return [...byBundleId.values()]
      .sort((a, b) => a.bundle.title.localeCompare(b.bundle.title))
      .map(({ bundle, role }) => ({ ...bundle, role }));
  });

  server.get<{ Params: { bundleId: string } }>("/bundles/:bundleId", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const allowed = await checkPermission(db, request.user, bundle, null, "view");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    return bundle;
  });

  server.post<{
    Body: { slug: string; title: string; isPublic?: boolean; defaultBranch?: string };
  }>("/bundles", { preHandler: requireAdmin() }, async (request, reply) => {
    const { slug, title, isPublic = false, defaultBranch = "main" } = request.body ?? {};

    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      return reply.code(400).send({
        error: "slug must be lowercase letters, digits, and hyphens (e.g. 'team-handbook')",
      });
    }
    if (typeof title !== "string" || !title.trim()) {
      return reply.code(400).send({ error: "title is required" });
    }

    try {
      const [bundle] = await db
        .insert(schema.bundles)
        .values({ slug, title: title.trim(), isPublic: isPublic === true, defaultBranch })
        .returning();

      reply.code(201);
      return bundle;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "A bundle with this slug already exists" });
      }
      throw err;
    }
  });

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/archive",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "manage");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const [updated] = await db
        .update(schema.bundles)
        .set({ archivedAt: new Date() })
        .where(eq(schema.bundles.id, bundle.id))
        .returning();

      return updated;
    },
  );

  server.post<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/unarchive",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "manage");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const [updated] = await db
        .update(schema.bundles)
        .set({ archivedAt: null })
        .where(eq(schema.bundles.id, bundle.id))
        .returning();

      return updated;
    },
  );

  // Title/visibility only — slug is the join key into the git tree
  // (`wiki/<slug>/...`), so renaming it would require moving the whole
  // subtree; not supported here.
  server.patch<{ Params: { bundleId: string }; Body: { title?: string; isPublic?: boolean } }>(
    "/bundles/:bundleId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "manage");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const { title, isPublic } = request.body ?? {};
      if (title !== undefined && (typeof title !== "string" || !title.trim())) {
        return reply.code(400).send({ error: "title must be a non-empty string" });
      }
      if (title === undefined && isPublic === undefined) {
        return reply.code(400).send({ error: "Nothing to update" });
      }
      const [updated] = await db
        .update(schema.bundles)
        .set({
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(isPublic !== undefined ? { isPublic: isPublic === true } : {}),
        })
        .where(eq(schema.bundles.id, bundle.id))
        .returning();

      return updated;
    },
  );

  // Dedicated mode route guarded by "review" (not the manage-only PATCH):
  // bundle managers decide whether their bundle is a raw wiki or an
  // LLM-compiled one, since they also review the compile MRs it produces.
  server.post<{ Params: { bundleId: string }; Body: { mode: "raw" | "llm_compiled" } }>(
    "/bundles/:bundleId/mode",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const { mode } = request.body;
      if (mode !== "raw" && mode !== "llm_compiled") {
        return reply.code(400).send({ error: "mode must be 'raw' or 'llm_compiled'" });
      }

      const [updated] = await db
        .update(schema.bundles)
        .set({ mode })
        .where(eq(schema.bundles.id, bundle.id))
        .returning();

      return updated;
    },
  );
}
