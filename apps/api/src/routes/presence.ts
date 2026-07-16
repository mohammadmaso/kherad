import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull, isUuid } from "../lib/get-bundle";

/** How long a heartbeat keeps a user "active" on a page for soft-lock purposes. */
const ACTIVE_WINDOW_MS = 30_000;

async function getPageOrNull(db: Database, bundleId: string, pageId: string) {
  if (!isUuid(pageId)) return undefined;
  return db.query.pages.findFirst({
    where: and(eq(schema.pages.id, pageId), eq(schema.pages.bundleId, bundleId)),
  });
}

export async function presenceRoutes(server: FastifyInstance, db: Database) {
  // Heartbeats mean "I am editing this page" (only the editor sends them), so
  // they require a signed-in user with edit rights — an anonymous viewer on a
  // public bundle must never be able to mark a page as being edited.
  server.post<{ Params: { bundleId: string; pageId: string } }>(
    "/bundles/:bundleId/pages/:pageId/presence",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const page = await getPageOrNull(db, bundle.id, request.params.pageId);
      if (!page) {
        return reply.code(404).send({ error: "Page not found" });
      }

      if (!request.user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const allowed = await checkPermission(db, request.user, bundle, page.path, "edit");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const user = request.user;

      await db
        .insert(schema.activeEditSessions)
        .values({ userId: user.id, pageId: page.id, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.activeEditSessions.userId, schema.activeEditSessions.pageId],
          set: { lastSeenAt: new Date() },
        });

      return reply.code(204).send();
    },
  );

  server.get<{ Params: { bundleId: string; pageId: string } }>(
    "/bundles/:bundleId/pages/:pageId/presence",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const page = await getPageOrNull(db, bundle.id, request.params.pageId);
      if (!page) {
        return reply.code(404).send({ error: "Page not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, page.path, "view");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
      const sessions = await db.query.activeEditSessions.findMany({
        where: and(
          eq(schema.activeEditSessions.pageId, page.id),
          gt(schema.activeEditSessions.lastSeenAt, cutoff),
        ),
        with: { user: true },
      });

      return sessions
        .filter((session) => session.userId !== request.user?.id)
        .map((session) => ({
          userId: session.userId,
          displayName: session.user.displayName,
          lastSeenAt: session.lastSeenAt,
        }));
    },
  );
}
