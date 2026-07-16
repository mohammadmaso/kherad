import { getSession, requireRole, type AuthedUser } from "@kherad/core/auth";
import type { Database } from "@kherad/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthedUser | null;
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function registerAuth(server: FastifyInstance, db: Database) {
  server.decorateRequest("user", null);

  server.addHook("preHandler", async (request) => {
    const token = extractToken(request);
    request.user = token ? await getSession(db, token) : null;
  });
}

export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };
}

export function requireAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(request.user, "admin")) {
      return reply.code(403).send({ error: "Forbidden" });
    }
  };
}
