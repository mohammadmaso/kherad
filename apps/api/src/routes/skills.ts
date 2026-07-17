import { canAccessAgents } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../plugins/auth";

const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_CONTENT_CHARS = 20_000;
const MAX_ROLE_KEYS = 20;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "skill"
  );
}

async function allocateSlug(db: Database, base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const taken = await db.query.skills.findFirst({
      where: excludeId
        ? and(eq(schema.skills.slug, candidate), ne(schema.skills.id, excludeId))
        : eq(schema.skills.slug, candidate),
      columns: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function normalizeRoleKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
    if (seen.size >= MAX_ROLE_KEYS) break;
  }
  return [...seen];
}

async function toSkillResponse(
  db: Database,
  row: typeof schema.skills.$inferSelect,
  withContent: boolean,
) {
  const roleDefaults = await db.query.skillRoleDefaults.findMany({
    where: eq(schema.skillRoleDefaults.skillId, row.id),
    columns: { roleKey: true },
  });
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    roleKeys: roleDefaults.map((r) => r.roleKey),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(withContent ? { content: row.content } : {}),
  };
}

export async function skillsRoutes(server: FastifyInstance, db: Database) {
  // Any agent-accessible user can list skills, to populate the session
  // creation picker (id/name/description/roleKeys — no content needed there).
  server.get("/skills", async (request, reply) => {
    if (!(await canAccessAgents(db, request.user))) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const rows = await db.query.skills.findMany({ orderBy: schema.skills.name });
    return Promise.all(rows.map((row) => toSkillResponse(db, row, false)));
  });

  server.get<{ Params: { id: string } }>(
    "/admin/skills/:id",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const row = await db.query.skills.findFirst({
        where: eq(schema.skills.id, request.params.id),
      });
      if (!row) return reply.code(404).send({ error: "Skill not found" });
      return toSkillResponse(db, row, true);
    },
  );

  server.post<{
    Body: { name: string; description?: string | null; content: string; roleKeys?: string[] };
  }>("/admin/skills", { preHandler: requireAdmin() }, async (request, reply) => {
    const user = request.user!;
    const name = request.body.name?.trim().slice(0, MAX_NAME_CHARS);
    const content = request.body.content?.trim().slice(0, MAX_CONTENT_CHARS);
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!content) return reply.code(400).send({ error: "content is required" });
    const description = request.body.description?.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
    const roleKeys = normalizeRoleKeys(request.body.roleKeys);
    const slug = await allocateSlug(db, slugify(name));

    const [row] = await db
      .insert(schema.skills)
      .values({ name, slug, description, content, createdById: user.id })
      .returning();
    if (!row) return reply.code(500).send({ error: "Failed to create skill" });

    if (roleKeys.length > 0) {
      await db
        .insert(schema.skillRoleDefaults)
        .values(roleKeys.map((roleKey) => ({ skillId: row.id, roleKey })));
    }

    reply.code(201);
    return toSkillResponse(db, row, true);
  });

  server.put<{
    Params: { id: string };
    Body: { name?: string; description?: string | null; content?: string; roleKeys?: string[] };
  }>("/admin/skills/:id", { preHandler: requireAdmin() }, async (request, reply) => {
    const existing = await db.query.skills.findFirst({
      where: eq(schema.skills.id, request.params.id),
    });
    if (!existing) return reply.code(404).send({ error: "Skill not found" });

    const updates: Partial<typeof schema.skills.$inferInsert> = { updatedAt: new Date() };
    if (request.body.name !== undefined) {
      const name = request.body.name.trim().slice(0, MAX_NAME_CHARS);
      if (!name) return reply.code(400).send({ error: "name cannot be empty" });
      updates.name = name;
    }
    if (request.body.description !== undefined) {
      updates.description = request.body.description?.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
    }
    if (request.body.content !== undefined) {
      const content = request.body.content.trim().slice(0, MAX_CONTENT_CHARS);
      if (!content) return reply.code(400).send({ error: "content cannot be empty" });
      updates.content = content;
    }

    const [row] = await db
      .update(schema.skills)
      .set(updates)
      .where(eq(schema.skills.id, existing.id))
      .returning();
    if (!row) return reply.code(500).send({ error: "Failed to update skill" });

    if (request.body.roleKeys !== undefined) {
      const roleKeys = normalizeRoleKeys(request.body.roleKeys);
      await db.delete(schema.skillRoleDefaults).where(eq(schema.skillRoleDefaults.skillId, row.id));
      if (roleKeys.length > 0) {
        await db
          .insert(schema.skillRoleDefaults)
          .values(roleKeys.map((roleKey) => ({ skillId: row.id, roleKey })));
      }
    }

    return toSkillResponse(db, row, true);
  });

  server.delete<{ Params: { id: string } }>(
    "/admin/skills/:id",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const [deleted] = await db
        .delete(schema.skills)
        .where(eq(schema.skills.id, request.params.id))
        .returning({ id: schema.skills.id });
      if (!deleted) return reply.code(404).send({ error: "Skill not found" });
      return { deleted: deleted.id };
    },
  );
}
