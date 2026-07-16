import { hashPassword } from "@kherad/core/auth";
import { schema, type Database } from "@kherad/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { isUniqueViolation } from "../lib/db-errors";
import { isUuid } from "../lib/get-bundle";
import { requireAdmin } from "../plugins/auth";

const MIN_PASSWORD_LENGTH = 8;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function adminRoutes(server: FastifyInstance, db: Database) {
  // Cross-bundle merge-request queue: admins review from one place rather
  // than having to open each bundle's own merge-requests list in turn.
  server.get<{ Querystring: { status?: string } }>(
    "/admin/merge-requests",
    { preHandler: requireAdmin() },
    async (request) => {
      const status = request.query.status as
        (typeof schema.mergeRequestStatusEnum.enumValues)[number] | undefined;

      return db.query.mergeRequests.findMany({
        where: status ? eq(schema.mergeRequests.status, status) : undefined,
        orderBy: desc(schema.mergeRequests.updatedAt),
        with: {
          author: { columns: { id: true, displayName: true, email: true } },
          bundle: { columns: { id: true, slug: true, title: true } },
        },
      });
    },
  );

  server.get("/admin/users", { preHandler: requireAdmin() }, async () => {
    return db.query.users.findMany({
      columns: {
        id: true,
        email: true,
        displayName: true,
        isAdmin: true,
        createdAt: true,
      },
      orderBy: (u, { asc }) => asc(u.email),
    });
  });

  server.post<{
    Body: { email: string; password: string; displayName: string; isAdmin?: boolean };
  }>("/admin/users", { preHandler: requireAdmin() }, async (request, reply) => {
    const { email, password, displayName, isAdmin = false } = request.body ?? {};
    if (typeof email !== "string" || !isValidEmail(email.trim())) {
      return reply.code(400).send({ error: "A valid email is required" });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return reply
        .code(400)
        .send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      return reply.code(400).send({ error: "displayName is required" });
    }

    const passwordHash = await hashPassword(password);

    try {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: email.trim(),
          passwordHash,
          displayName: displayName.trim(),
          isAdmin: isAdmin === true,
        })
        .returning({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          isAdmin: schema.users.isAdmin,
        });

      reply.code(201);
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "A user with this email already exists" });
      }
      throw err;
    }
  });

  server.patch<{
    Params: { userId: string };
    Body: { displayName?: string; email?: string; isAdmin?: boolean };
  }>("/admin/users/:userId", { preHandler: requireAdmin() }, async (request, reply) => {
    if (!isUuid(request.params.userId)) {
      return reply.code(404).send({ error: "User not found" });
    }
    const { displayName, email, isAdmin } = request.body ?? {};
    if (email !== undefined && (typeof email !== "string" || !isValidEmail(email.trim()))) {
      return reply.code(400).send({ error: "A valid email is required" });
    }
    if (displayName !== undefined && (typeof displayName !== "string" || !displayName.trim())) {
      return reply.code(400).send({ error: "displayName must be a non-empty string" });
    }
    if (displayName === undefined && email === undefined && isAdmin === undefined) {
      return reply.code(400).send({ error: "Nothing to update" });
    }

    try {
      const [updated] = await db
        .update(schema.users)
        .set({
          ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
          ...(email !== undefined ? { email: email.trim() } : {}),
          ...(isAdmin !== undefined ? { isAdmin: isAdmin === true } : {}),
        })
        .where(eq(schema.users.id, request.params.userId))
        .returning({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          isAdmin: schema.users.isAdmin,
          createdAt: schema.users.createdAt,
        });

      if (!updated) {
        return reply.code(404).send({ error: "User not found" });
      }

      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "A user with this email already exists" });
      }
      throw err;
    }
  });
}
