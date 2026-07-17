import { schema, type Database } from "@kherad/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/**
 * In-app notification recipients for a bundle event: every admin plus every
 * user holding a `manager` grant anywhere in the bundle (bundle-level or
 * path-scoped) — a path-scoped manager still oversees part of the bundle and
 * should hear about work landing there. Excludes `excludeUserId` so authors
 * don't get notified about their own submission.
 */
async function reviewNotificationRecipients(
  db: Database,
  bundleId: string,
  excludeUserId: string,
): Promise<string[]> {
  const [admins, managerGrants] = await Promise.all([
    db.query.users.findMany({
      where: eq(schema.users.isAdmin, true),
      columns: { id: true },
    }),
    db.query.permissions.findMany({
      where: and(
        eq(schema.permissions.bundleId, bundleId),
        eq(schema.permissions.role, "manager"),
      ),
      columns: { userId: true },
    }),
  ]);

  const ids = new Set([...admins.map((u) => u.id), ...managerGrants.map((g) => g.userId)]);
  ids.delete(excludeUserId);
  return [...ids];
}

/** Notifies a bundle's managers/admins that an MR needs review. Best-effort: never throws. */
export async function notifyMrSubmitted(
  db: Database,
  bundle: { id: string; title: string },
  mr: { id: string; scope: string },
  authorDisplayName: string,
): Promise<void> {
  try {
    const recipients = await reviewNotificationRecipients(db, bundle.id, mr.id);
    if (recipients.length === 0) return;

    const body =
      mr.scope === "okf"
        ? `${authorDisplayName} submitted compiled-doc changes in "${bundle.title}" for review.`
        : `${authorDisplayName} submitted changes in "${bundle.title}" for review.`;

    await db.insert(schema.notifications).values(
      recipients.map((userId) => ({
        userId,
        type: "mr_submitted" as const,
        bundleId: bundle.id,
        mrId: mr.id,
        body,
      })),
    );
  } catch {
    // Notifications are best-effort — a delivery failure must never block submit.
  }
}

export async function notificationRoutes(server: FastifyInstance, db: Database) {
  server.get("/notifications", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return db.query.notifications.findMany({
      where: eq(schema.notifications.userId, request.user.id),
      orderBy: desc(schema.notifications.createdAt),
      limit: 50,
      with: { bundle: { columns: { id: true, slug: true, title: true } } },
    });
  });

  server.post<{ Params: { notificationId: string } }>(
    "/notifications/:notificationId/read",
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const [updated] = await db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.id, request.params.notificationId),
            eq(schema.notifications.userId, request.user.id),
          ),
        )
        .returning();
      if (!updated) {
        return reply.code(404).send({ error: "Notification not found" });
      }
      return updated;
    },
  );

  server.post("/notifications/read-all", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(schema.notifications.userId, request.user.id), isNull(schema.notifications.readAt)),
      );
    return { ok: true };
  });
}
