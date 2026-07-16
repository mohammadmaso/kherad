import { isUserLocale, login, logout, updateUserPreferences } from "@kherad/core/auth";
import type { Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

// Password login is the one endpoint worth brute-forcing, so failed attempts
// are rate-limited per IP with the same in-memory sliding window the chat
// route uses for anonymous callers. Successful logins never count against it.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 20;
const loginFailures = new Map<string, number[]>();

function recentLoginFailures(ip: string): number[] {
  const now = Date.now();
  if (loginFailures.size > 1000) {
    for (const [key, hits] of loginFailures) {
      if (hits.every((t) => now - t >= LOGIN_WINDOW_MS)) loginFailures.delete(key);
    }
  }
  const recent = (loginFailures.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFailures.set(ip, recent);
  return recent;
}

export async function authRoutes(server: FastifyInstance, db: Database) {
  server.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    async (request, reply) => {
      const { email, password } = request.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        return reply.code(400).send({ error: "email and password are required" });
      }

      const failures = recentLoginFailures(request.ip);
      if (failures.length >= LOGIN_MAX_FAILURES) {
        return reply.code(429).send({ error: "Too many failed login attempts — try again later" });
      }

      const result = await login(db, email, password);
      if (!result) {
        failures.push(Date.now());
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      loginFailures.delete(request.ip);
      return result;
    },
  );

  server.post("/auth/logout", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (token) {
      await logout(db, token);
    }
    return reply.code(204).send();
  });

  server.get("/auth/me", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return request.user;
  });

  server.patch<{ Body: { locale?: unknown } }>("/auth/me/preferences", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { locale } = request.body ?? {};
    if (!isUserLocale(locale)) {
      return reply.code(400).send({ error: "locale must be one of: en, fa" });
    }
    const updated = await updateUserPreferences(db, request.user.id, { locale });
    if (!updated) {
      return reply.code(404).send({ error: "User not found" });
    }
    return updated;
  });
}
