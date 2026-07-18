import { canAccessAgents } from "@kherad/core/permissions";
import { encryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  authResetFields,
  clearMcpOauthClientRegistration,
  completeMcpOauth,
  oauthRedirectUrl,
  resetMcpAuthState,
  startMcpOauth,
  testMcpServerConnection,
  userMcpStatus,
  type McpServerRow,
} from "../agents/mcp";
import { isUniqueViolation } from "../lib/db-errors";
import { requireAdmin } from "../plugins/auth";

const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_SLUG_CHARS = 80;
const MAX_URL_CHARS = 2000;
const MAX_SCOPES_CHARS = 500;
const MAX_HEADER_ENTRIES = 20;

const TRANSPORTS = ["auto", "http", "sse"] as const;
const AUTH_TYPES = ["none", "headers", "oauth2_auth_code", "oauth2_client_credentials"] as const;

type Transport = (typeof TRANSPORTS)[number];
type AuthType = (typeof AUTH_TYPES)[number];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG_CHARS) || "mcp"
  );
}

async function allocateSlug(db: Database, base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const taken = await db.query.mcpServers.findFirst({
      where: excludeId
        ? and(eq(schema.mcpServers.slug, candidate), ne(schema.mcpServers.id, excludeId))
        : eq(schema.mcpServers.slug, candidate),
      columns: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${base}-${suffix}`.slice(0, MAX_SLUG_CHARS);
    suffix += 1;
  }
}

function parseTransport(value: unknown): Transport | null {
  return typeof value === "string" && (TRANSPORTS as readonly string[]).includes(value)
    ? (value as Transport)
    : null;
}

function parseAuthType(value: unknown): AuthType | null {
  return typeof value === "string" && (AUTH_TYPES as readonly string[]).includes(value)
    ? (value as AuthType)
    : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function webOrigin(): string {
  const raw = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  return (raw || "http://localhost:3000").replace(/\/$/, "");
}

function normalizeHeaders(
  input: unknown,
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "headers must be an object of string values" };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    if (typeof value !== "string" || !value) {
      return { ok: false, error: `header "${name}" must be a non-empty string` };
    }
    out[name] = value;
    if (Object.keys(out).length > MAX_HEADER_ENTRIES) {
      return { ok: false, error: `at most ${MAX_HEADER_ENTRIES} headers allowed` };
    }
  }
  return { ok: true, headers: out };
}

function toPublicMcpServer(
  row: McpServerRow,
  status: McpServerRow["status"],
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    authType: row.authType,
    status,
    toolNames: row.toolNames ?? [],
  };
}

function toAdminMcpServer(
  row: McpServerRow,
  extras?: {
    hasUserTokens?: boolean;
    userStatus?: McpServerRow["status"];
    userTokenExpiresAt?: Date | null;
  },
) {
  const isAuthCode = row.authType === "oauth2_auth_code";
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    url: row.url,
    transport: row.transport,
    authType: row.authType,
    enabled: row.enabled,
    headerNames: row.headerNames ?? [],
    hasHeaders: !!row.headersEnc,
    oauthUseDcr: row.oauthUseDcr,
    oauthClientId: row.oauthClientId,
    hasClientSecret: !!row.oauthClientSecretEnc,
    oauthScopes: row.oauthScopes,
    oauthRedirectUri: isAuthCode ? oauthRedirectUrl(row.id) : null,
    hasTokens: isAuthCode ? !!extras?.hasUserTokens : !!row.oauthTokensEnc,
    oauthTokenExpiresAt: isAuthCode
      ? (extras?.userTokenExpiresAt?.toISOString() ?? null)
      : (row.oauthTokenExpiresAt?.toISOString() ?? null),
    status: isAuthCode ? (extras?.userStatus ?? "needs_auth") : row.status,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    toolNames: row.toolNames ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function adminServerResponse(db: Database, row: McpServerRow, userId: string) {
  if (row.authType !== "oauth2_auth_code") {
    return toAdminMcpServer(row);
  }
  const userAuth = await db.query.mcpUserAuths.findFirst({
    where: and(
      eq(schema.mcpUserAuths.mcpServerId, row.id),
      eq(schema.mcpUserAuths.userId, userId),
    ),
  });
  return toAdminMcpServer(row, {
    hasUserTokens: !!userAuth?.oauthTokensEnc,
    userStatus: userAuth?.oauthTokensEnc
      ? userAuth.status
      : "needs_auth",
    userTokenExpiresAt: userAuth?.oauthTokenExpiresAt ?? null,
  });
}

export async function mcpServerRoutes(server: FastifyInstance, db: Database) {
  // Session-creation picker — enabled servers; status is per-user for auth-code.
  server.get("/mcp-servers", async (request, reply) => {
    if (!(await canAccessAgents(db, request.user))) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;
    const rows = await db.query.mcpServers.findMany({
      where: eq(schema.mcpServers.enabled, true),
      orderBy: schema.mcpServers.name,
    });
    return Promise.all(
      rows.map(async (row) =>
        toPublicMcpServer(row, await userMcpStatus(db, row, user.id)),
      ),
    );
  });

  server.get("/admin/mcp-servers", { preHandler: requireAdmin() }, async (request) => {
    const user = request.user!;
    const rows = await db.query.mcpServers.findMany({ orderBy: schema.mcpServers.name });
    return Promise.all(rows.map((row) => adminServerResponse(db, row, user.id)));
  });

  server.get<{ Params: { id: string } }>(
    "/admin/mcp-servers/:id",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const row = await db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, request.params.id),
      });
      if (!row) return reply.code(404).send({ error: "MCP server not found" });
      return adminServerResponse(db, row, request.user!.id);
    },
  );

  server.post<{
    Body: {
      name: string;
      slug?: string;
      description?: string | null;
      url: string;
      transport?: string;
      authType?: string;
      enabled?: boolean;
      headers?: Record<string, string>;
      oauthUseDcr?: boolean;
      oauthClientId?: string | null;
      oauthClientSecret?: string | null;
      oauthScopes?: string | null;
    };
  }>("/admin/mcp-servers", { preHandler: requireAdmin() }, async (request, reply) => {
    const user = request.user!;
    const name = request.body.name?.trim().slice(0, MAX_NAME_CHARS);
    const url = request.body.url?.trim().slice(0, MAX_URL_CHARS);
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!url || !isHttpUrl(url)) {
      return reply.code(400).send({ error: "url must be a valid http(s) URL" });
    }

    const transport = request.body.transport ? parseTransport(request.body.transport) : "auto";
    if (!transport) return reply.code(400).send({ error: "Invalid transport" });
    const authType = request.body.authType ? parseAuthType(request.body.authType) : "none";
    if (!authType) return reply.code(400).send({ error: "Invalid authType" });

    const description =
      request.body.description?.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
    const slugBase = request.body.slug?.trim()
      ? slugify(request.body.slug)
      : slugify(name);
    const slug = await allocateSlug(db, slugBase);

    const values: typeof schema.mcpServers.$inferInsert = {
      name,
      slug,
      description,
      url,
      transport,
      authType,
      enabled: request.body.enabled !== false,
      createdById: user.id,
    };

    if (authType === "headers") {
      const parsed = normalizeHeaders(request.body.headers ?? {});
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      if (Object.keys(parsed.headers).length === 0) {
        return reply.code(400).send({ error: "headers are required for headers auth" });
      }
      values.headersEnc = encryptRemoteToken(JSON.stringify(parsed.headers));
      values.headerNames = Object.keys(parsed.headers);
    }

    if (authType === "oauth2_auth_code" || authType === "oauth2_client_credentials") {
      values.oauthUseDcr =
        authType === "oauth2_auth_code" ? request.body.oauthUseDcr !== false : false;
      values.oauthScopes = request.body.oauthScopes?.trim().slice(0, MAX_SCOPES_CHARS) || null;
      values.oauthClientId = request.body.oauthClientId?.trim() || null;
      if (request.body.oauthClientSecret?.trim()) {
        values.oauthClientSecretEnc = encryptRemoteToken(request.body.oauthClientSecret.trim());
      }
      if (authType === "oauth2_client_credentials") {
        if (!values.oauthClientId || !values.oauthClientSecretEnc) {
          return reply
            .code(400)
            .send({ error: "oauthClientId and oauthClientSecret are required" });
        }
      }
      if (authType === "oauth2_auth_code" && values.oauthUseDcr === false && !values.oauthClientId) {
        return reply.code(400).send({ error: "oauthClientId is required when DCR is disabled" });
      }
    }

    try {
      const [row] = await db.insert(schema.mcpServers).values(values).returning();
      if (!row) return reply.code(500).send({ error: "Failed to create MCP server" });
      reply.code(201);
      return adminServerResponse(db, row, user.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "Slug already exists" });
      }
      throw err;
    }
  });

  server.put<{
    Params: { id: string };
    Body: {
      name?: string;
      slug?: string;
      description?: string | null;
      url?: string;
      transport?: string;
      authType?: string;
      enabled?: boolean;
      headers?: Record<string, string>;
      clearHeaders?: boolean;
      oauthUseDcr?: boolean;
      oauthClientId?: string | null;
      oauthClientSecret?: string | null;
      clearClientSecret?: boolean;
      oauthScopes?: string | null;
    };
  }>("/admin/mcp-servers/:id", { preHandler: requireAdmin() }, async (request, reply) => {
    const existing = await db.query.mcpServers.findFirst({
      where: eq(schema.mcpServers.id, request.params.id),
    });
    if (!existing) return reply.code(404).send({ error: "MCP server not found" });

    const updates: Partial<typeof schema.mcpServers.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (request.body.name !== undefined) {
      const name = request.body.name.trim().slice(0, MAX_NAME_CHARS);
      if (!name) return reply.code(400).send({ error: "name cannot be empty" });
      updates.name = name;
    }
    if (request.body.description !== undefined) {
      updates.description =
        request.body.description?.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
    }
    if (request.body.slug !== undefined) {
      const slug = slugify(request.body.slug);
      if (!slug) return reply.code(400).send({ error: "slug cannot be empty" });
      updates.slug = await allocateSlug(db, slug, existing.id);
    }
    if (request.body.enabled !== undefined) {
      updates.enabled = !!request.body.enabled;
    }

    let nextUrl = existing.url;
    let nextAuthType = existing.authType;
    let urlOrAuthChanged = false;

    if (request.body.url !== undefined) {
      const url = request.body.url.trim().slice(0, MAX_URL_CHARS);
      if (!url || !isHttpUrl(url)) {
        return reply.code(400).send({ error: "url must be a valid http(s) URL" });
      }
      updates.url = url;
      nextUrl = url;
      if (url !== existing.url) urlOrAuthChanged = true;
    }
    if (request.body.transport !== undefined) {
      const transport = parseTransport(request.body.transport);
      if (!transport) return reply.code(400).send({ error: "Invalid transport" });
      updates.transport = transport;
    }
    if (request.body.authType !== undefined) {
      const authType = parseAuthType(request.body.authType);
      if (!authType) return reply.code(400).send({ error: "Invalid authType" });
      updates.authType = authType;
      nextAuthType = authType;
      if (authType !== existing.authType) urlOrAuthChanged = true;
    }

    if (urlOrAuthChanged) {
      Object.assign(updates, authResetFields());
      await resetMcpAuthState(db, existing.id);
    }

    // Headers
    if (request.body.clearHeaders) {
      updates.headersEnc = null;
      updates.headerNames = null;
    } else if (request.body.headers !== undefined) {
      const parsed = normalizeHeaders(request.body.headers);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      if (Object.keys(parsed.headers).length > 0) {
        updates.headersEnc = encryptRemoteToken(JSON.stringify(parsed.headers));
        updates.headerNames = Object.keys(parsed.headers);
      }
    }

    // OAuth fields
    if (request.body.oauthUseDcr !== undefined) {
      updates.oauthUseDcr = !!request.body.oauthUseDcr;
    }
    if (request.body.oauthClientId !== undefined) {
      updates.oauthClientId = request.body.oauthClientId?.trim() || null;
    }
    if (request.body.oauthScopes !== undefined) {
      updates.oauthScopes =
        request.body.oauthScopes?.trim().slice(0, MAX_SCOPES_CHARS) || null;
    }
    if (request.body.clearClientSecret) {
      updates.oauthClientSecretEnc = null;
    } else if (request.body.oauthClientSecret?.trim()) {
      updates.oauthClientSecretEnc = encryptRemoteToken(request.body.oauthClientSecret.trim());
    }

    // Validate resulting auth config
    const effectiveAuth = nextAuthType;
    if (effectiveAuth === "headers") {
      const willHaveHeaders =
        updates.headersEnc !== undefined ? !!updates.headersEnc : !!existing.headersEnc;
      if (!willHaveHeaders) {
        return reply.code(400).send({ error: "headers are required for headers auth" });
      }
    }
    if (effectiveAuth === "oauth2_client_credentials") {
      const clientId =
        updates.oauthClientId !== undefined ? updates.oauthClientId : existing.oauthClientId;
      const hasSecret =
        updates.oauthClientSecretEnc !== undefined
          ? !!updates.oauthClientSecretEnc
          : !!existing.oauthClientSecretEnc;
      if (!clientId || !hasSecret) {
        return reply
          .code(400)
          .send({ error: "oauthClientId and oauthClientSecret are required" });
      }
    }

    void nextUrl;

    try {
      const [row] = await db
        .update(schema.mcpServers)
        .set(updates)
        .where(eq(schema.mcpServers.id, existing.id))
        .returning();
      if (!row) return reply.code(500).send({ error: "Failed to update MCP server" });
      return adminServerResponse(db, row, request.user!.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "Slug already exists" });
      }
      throw err;
    }
  });

  server.delete<{ Params: { id: string } }>(
    "/admin/mcp-servers/:id",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const [deleted] = await db
        .delete(schema.mcpServers)
        .where(eq(schema.mcpServers.id, request.params.id))
        .returning({ id: schema.mcpServers.id });
      if (!deleted) return reply.code(404).send({ error: "MCP server not found" });
      return { deleted: deleted.id };
    },
  );

  server.post<{ Params: { id: string } }>(
    "/admin/mcp-servers/:id/test",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const row = await db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, request.params.id),
      });
      if (!row) return reply.code(404).send({ error: "MCP server not found" });
      return testMcpServerConnection(db, row, request.user!.id);
    },
  );

  // Force re-DCR (fixes Metabase 400 when redirect_uri drifted after callback path changes).
  server.post<{ Params: { id: string } }>(
    "/admin/mcp-servers/:id/oauth/reset-client",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const row = await db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, request.params.id),
      });
      if (!row) return reply.code(404).send({ error: "MCP server not found" });
      if (row.authType !== "oauth2_auth_code") {
        return reply.code(400).send({ error: "Server does not use authorization-code OAuth" });
      }
      await clearMcpOauthClientRegistration(db, row.id);
      const fresh = await db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, row.id),
      });
      return adminServerResponse(db, fresh ?? row, request.user!.id);
    },
  );

  // Per-user OAuth start — any agent-accessible user can authorize their own tokens.
  server.post<{
    Params: { id: string };
    Body: { returnTo?: string };
  }>("/mcp-servers/:id/oauth/start", async (request, reply) => {
    if (!(await canAccessAgents(db, request.user))) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;
    const row = await db.query.mcpServers.findFirst({
      where: eq(schema.mcpServers.id, request.params.id),
    });
    if (!row || !row.enabled) {
      return reply.code(404).send({ error: "MCP server not found" });
    }
    if (row.authType !== "oauth2_auth_code") {
      return reply.code(400).send({ error: "Server does not use authorization-code OAuth" });
    }
    try {
      const result = await startMcpOauth(db, row, user.id, request.body?.returnTo);
      if (!result.authorizationUrl) {
        return { authorizationUrl: null, alreadyAuthorized: true };
      }
      return { authorizationUrl: result.authorizationUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // Admin alias → same per-user flow, returns to admin MCP page.
  server.post<{ Params: { id: string } }>(
    "/admin/mcp-servers/:id/oauth/start",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const row = await db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, request.params.id),
      });
      if (!row) return reply.code(404).send({ error: "MCP server not found" });
      if (row.authType !== "oauth2_auth_code") {
        return reply.code(400).send({ error: "Server does not use authorization-code OAuth" });
      }
      try {
        const result = await startMcpOauth(db, row, request.user!.id, "/admin/mcp");
        if (!result.authorizationUrl) {
          return { authorizationUrl: null, alreadyAuthorized: true };
        }
        return { authorizationUrl: result.authorizationUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  // Unauthenticated by necessity — top-level browser redirect from the AS.
  // Registered redirect_uri for all users (admin + agent).
  server.get<{
    Params: { id: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>("/mcp-servers/:id/oauth/callback", async (request, reply) => {
    const origin = webOrigin();
    const id = request.params.id;

    const appendQuery = (path: string, key: string, value: string) => {
      const sep = path.includes("?") ? "&" : "?";
      return `${origin}${path}${sep}${key}=${encodeURIComponent(value)}`;
    };

    if (request.query.error) {
      // Best-effort: clear pending for any matching server rows that still have state.
      // Exact user is unknown without state; completeMcpOauth handles state lookup.
      return reply.redirect(appendQuery("/agents", "oauthError", "provider_error"));
    }

    const code = request.query.code;
    const state = request.query.state;
    if (!code || !state) {
      return reply.redirect(appendQuery("/agents", "oauthError", "missing_params"));
    }

    const result = await completeMcpOauth(db, id, code, state);
    if (!result.ok) {
      return reply.redirect(appendQuery(result.returnTo, "oauthError", result.errorCode));
    }
    return reply.redirect(appendQuery(result.returnTo, "connected", result.serverId));
  });
}
