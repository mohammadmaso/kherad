import { checkPermission } from "@kherad/core/permissions";
import { normalizePagePath } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull, isUuid } from "../lib/get-bundle";

type PermissionRole = (typeof schema.permissionRoleEnum.enumValues)[number];

function isPermissionRole(value: unknown): value is PermissionRole {
  return (schema.permissionRoleEnum.enumValues as readonly string[]).includes(value as string);
}

export async function permissionRoutes(server: FastifyInstance, db: Database) {
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/permissions",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "manage");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      return db.query.permissions.findMany({
        where: eq(schema.permissions.bundleId, bundle.id),
        with: { user: { columns: { id: true, email: true, displayName: true } } },
      });
    },
  );

  server.post<{
    Params: { bundleId: string };
    Body: { userId: string; role: PermissionRole; pathPrefix?: string | null };
  }>("/bundles/:bundleId/permissions", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const allowed = await checkPermission(db, request.user, bundle, null, "manage");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const { userId, role, pathPrefix = null } = request.body ?? {};
    if (typeof userId !== "string" || !isUuid(userId)) {
      return reply.code(400).send({ error: "userId must be a user id" });
    }
    if (!isPermissionRole(role)) {
      return reply.code(400).send({ error: "role must be viewer, author, or manager" });
    }
    let normalizedPrefix: string | null = null;
    if (pathPrefix !== null && pathPrefix !== undefined && pathPrefix !== "") {
      if (typeof pathPrefix !== "string") {
        return reply.code(400).send({ error: "pathPrefix must be a string" });
      }
      normalizedPrefix = normalizePagePath(pathPrefix);
      if (normalizedPrefix === null) {
        return reply.code(400).send({ error: "Invalid pathPrefix" });
      }
    }

    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { id: true },
    });
    if (!targetUser) {
      return reply.code(404).send({ error: "User not found" });
    }

    const [grant] = await db
      .insert(schema.permissions)
      .values({ userId, bundleId: bundle.id, role, pathPrefix: normalizedPrefix })
      .returning();

    reply.code(201);
    return grant;
  });

  server.delete<{ Params: { bundleId: string; permissionId: string } }>(
    "/bundles/:bundleId/permissions/:permissionId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "manage");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      if (!isUuid(request.params.permissionId)) {
        return reply.code(404).send({ error: "Permission grant not found" });
      }

      const [deleted] = await db
        .delete(schema.permissions)
        .where(
          and(
            eq(schema.permissions.id, request.params.permissionId),
            eq(schema.permissions.bundleId, bundle.id),
          ),
        )
        .returning();

      if (!deleted) {
        return reply.code(404).send({ error: "Permission grant not found" });
      }

      return reply.code(204).send();
    },
  );
}
