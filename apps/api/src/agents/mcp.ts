import { randomBytes, timingSafeEqual } from "node:crypto";

import { decryptRemoteToken, encryptRemoteToken } from "@kherad/core/git";
import { schema, type Database } from "@kherad/db";
import { MCPClient, type MastraMCPServerDefinition } from "@mastra/mcp";
import {
  auth,
  discoverOAuthServerInfo,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { and, eq, sql } from "drizzle-orm";

export type McpServerRow = typeof schema.mcpServers.$inferSelect;
export type McpUserAuthRow = typeof schema.mcpUserAuths.$inferSelect;

type LogLike = {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
};

const CONNECT_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;

function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

/** Single registered redirect URI for all users (admin + agent). */
export function oauthRedirectUrl(serverId: string): string {
  return `${apiPublicUrl()}/mcp-servers/${serverId}/oauth/callback`;
}

function clientRedirectUris(info: OAuthClientInformationMixed): string[] | null {
  if (!("redirect_uris" in info) || !Array.isArray(info.redirect_uris)) return null;
  const uris = info.redirect_uris.filter((u): u is string => typeof u === "string");
  return uris.length > 0 ? uris : null;
}

function clientMatchesRedirect(
  info: OAuthClientInformationMixed,
  redirectUrl: string,
): boolean {
  const uris = clientRedirectUris(info);
  // Older registrations may omit redirect_uris — treat as stale so we re-DCR
  // against the current callback path (avoids Metabase 400 invalid redirect_uri).
  if (!uris) return false;
  return uris.includes(redirectUrl);
}

function encryptJson(value: unknown): string {
  return encryptRemoteToken(JSON.stringify(value));
}

function decryptJson<T>(ciphertext: string): T {
  return JSON.parse(decryptRemoteToken(ciphertext)) as T;
}

function tokenExpiresAt(tokens: OAuthTokens): Date | null {
  if (typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in)) {
    return null;
  }
  return new Date(Date.now() + tokens.expires_in * 1000);
}

function isExpiringSoon(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
}

/** Constant-time compare for OAuth state (pads shorter side). */
export function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return aBuf.length === bBuf.length && timingSafeEqual(aPad, bPad);
}

/**
 * Only allow relative same-origin return paths (open-redirect protection).
 * Defaults to /agents when missing/invalid.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/agents";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/agents";
  if (trimmed.includes("://") || trimmed.includes("\\")) return "/agents";
  if (trimmed.startsWith("/admin/mcp") || trimmed.startsWith("/agents")) {
    return trimmed.slice(0, 500);
  }
  return "/agents";
}

export async function getOrCreateUserAuth(
  db: Database,
  serverId: string,
  userId: string,
): Promise<McpUserAuthRow> {
  const existing = await db.query.mcpUserAuths.findFirst({
    where: and(
      eq(schema.mcpUserAuths.mcpServerId, serverId),
      eq(schema.mcpUserAuths.userId, userId),
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.mcpUserAuths)
    .values({ mcpServerId: serverId, userId })
    .returning();
  if (!created) throw new Error("Failed to create MCP user auth row");
  return created;
}

/**
 * DB-backed OAuthClientProvider. Client registration (DCR / manual) is shared
 * on the server row; tokens + PKCE pending state are per-user.
 */
export class DbOAuthClientProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private server: McpServerRow;
  private userAuth: McpUserAuthRow;

  constructor(
    private readonly db: Database,
    server: McpServerRow,
    userAuth: McpUserAuthRow,
  ) {
    this.server = server;
    this.userAuth = userAuth;
  }

  get redirectUrl(): string {
    return oauthRedirectUrl(this.server.id);
  }

  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      client_name: "Kherad",
    };
    if (this.server.oauthScopes?.trim()) {
      meta.scope = this.server.oauthScopes.trim();
    }
    return meta;
  }

  state(): string {
    if (!this.userAuth.oauthPendingState) {
      throw new Error("OAuth pending state is not set");
    }
    return this.userAuth.oauthPendingState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (!this.server.oauthUseDcr) {
      if (!this.server.oauthClientId) return undefined;
      const info: OAuthClientInformationMixed = {
        client_id: this.server.oauthClientId,
      };
      if (this.server.oauthClientSecretEnc) {
        (info as { client_secret?: string }).client_secret = decryptRemoteToken(
          this.server.oauthClientSecretEnc,
        );
      }
      return info;
    }
    if (!this.server.oauthClientInfoEnc) return undefined;
    try {
      const info = decryptJson<OAuthClientInformationMixed>(this.server.oauthClientInfoEnc);
      if (!clientMatchesRedirect(info, this.redirectUrl)) {
        // Shared client was registered with a different callback (e.g. legacy
        // /oauth/admin/callback). Metabase rejects the authorize request with 400.
        await this.invalidateCredentials("client");
        return undefined;
      }
      return info;
    } catch {
      return undefined;
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    // Always persist the redirect we registered with so future starts can detect drift.
    const enriched: OAuthClientInformationMixed = {
      ...info,
      redirect_uris: clientRedirectUris(info) ?? [this.redirectUrl],
    };
    const [updated] = await this.db
      .update(schema.mcpServers)
      .set({
        oauthClientInfoEnc: encryptJson(enriched),
        oauthClientId: enriched.client_id,
        updatedAt: new Date(),
      })
      .where(eq(schema.mcpServers.id, this.server.id))
      .returning();
    if (updated) this.server = updated;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      await clearMcpOauthClientRegistration(this.db, this.server.id);
      const fresh = await this.db.query.mcpServers.findFirst({
        where: eq(schema.mcpServers.id, this.server.id),
      });
      if (fresh) this.server = fresh;
      this.userAuth = await getOrCreateUserAuth(
        this.db,
        this.server.id,
        this.userAuth.userId,
      );
      return;
    }

    if (scope === "client") {
      // Drop DCR client only. Keep per-user pending PKCE/state so an in-flight
      // startMcpOauth can continue and re-register against the current redirect.
      const [updated] = await this.db
        .update(schema.mcpServers)
        .set({
          oauthClientInfoEnc: null,
          ...(this.server.oauthUseDcr ? { oauthClientId: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.mcpServers.id, this.server.id))
        .returning();
      if (updated) this.server = updated;
      await this.db
        .update(schema.mcpUserAuths)
        .set({
          oauthTokensEnc: null,
          oauthTokenExpiresAt: null,
          status: "needs_auth",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.mcpUserAuths.mcpServerId, this.server.id));
      const refreshed = await this.db.query.mcpUserAuths.findFirst({
        where: and(
          eq(schema.mcpUserAuths.mcpServerId, this.userAuth.mcpServerId),
          eq(schema.mcpUserAuths.userId, this.userAuth.userId),
        ),
      });
      if (refreshed) this.userAuth = refreshed;
      return;
    }

    if (scope === "tokens") {
      const [updated] = await this.db
        .update(schema.mcpUserAuths)
        .set({
          oauthTokensEnc: null,
          oauthTokenExpiresAt: null,
          status: "needs_auth",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.mcpUserAuths.mcpServerId, this.userAuth.mcpServerId),
            eq(schema.mcpUserAuths.userId, this.userAuth.userId),
          ),
        )
        .returning();
      if (updated) this.userAuth = updated;
      return;
    }

    if (scope === "verifier") {
      const [updated] = await this.db
        .update(schema.mcpUserAuths)
        .set({
          oauthPendingVerifierEnc: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.mcpUserAuths.mcpServerId, this.userAuth.mcpServerId),
            eq(schema.mcpUserAuths.userId, this.userAuth.userId),
          ),
        )
        .returning();
      if (updated) this.userAuth = updated;
    }
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (!this.userAuth.oauthTokensEnc) return undefined;
    try {
      return decryptJson<OAuthTokens>(this.userAuth.oauthTokensEnc);
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const expiresAt = tokenExpiresAt(tokens);
    const enc = encryptJson(tokens);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT mcp_server_id FROM mcp_user_auths WHERE mcp_server_id = ${this.userAuth.mcpServerId} AND user_id = ${this.userAuth.userId} FOR UPDATE`,
      );
      const [updated] = await tx
        .update(schema.mcpUserAuths)
        .set({
          oauthTokensEnc: enc,
          oauthTokenExpiresAt: expiresAt,
          status: "ok",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.mcpUserAuths.mcpServerId, this.userAuth.mcpServerId),
            eq(schema.mcpUserAuths.userId, this.userAuth.userId),
          ),
        )
        .returning();
      if (updated) this.userAuth = updated;
    });
  }

  async codeVerifier(): Promise<string> {
    if (!this.userAuth.oauthPendingVerifierEnc) {
      throw new Error("OAuth code verifier is not set");
    }
    return decryptRemoteToken(this.userAuth.oauthPendingVerifierEnc);
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    const [updated] = await this.db
      .update(schema.mcpUserAuths)
      .set({
        oauthPendingVerifierEnc: encryptRemoteToken(verifier),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mcpUserAuths.mcpServerId, this.userAuth.mcpServerId),
          eq(schema.mcpUserAuths.userId, this.userAuth.userId),
        ),
      )
      .returning();
    if (updated) this.userAuth = updated;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url;
  }

  setUserAuth(row: McpUserAuthRow): void {
    this.userAuth = row;
  }
}

/** Discover token endpoint and obtain a client_credentials access token (shared). */
export async function ensureClientCredentialsToken(
  db: Database,
  row: McpServerRow,
): Promise<McpServerRow> {
  if (row.oauthTokensEnc && !isExpiringSoon(row.oauthTokenExpiresAt)) {
    return row;
  }

  const locked = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM mcp_servers WHERE id = ${row.id} FOR UPDATE`);
    const fresh = await tx.query.mcpServers.findFirst({
      where: eq(schema.mcpServers.id, row.id),
    });
    if (!fresh) throw new Error("MCP server not found");
    if (fresh.oauthTokensEnc && !isExpiringSoon(fresh.oauthTokenExpiresAt)) {
      return fresh;
    }

    if (!fresh.oauthClientId || !fresh.oauthClientSecretEnc) {
      throw new Error("client_id and client_secret are required for client_credentials");
    }

    const serverInfo = await discoverOAuthServerInfo(fresh.url);
    const tokenEndpoint = serverInfo.authorizationServerMetadata?.token_endpoint;
    if (!tokenEndpoint) {
      throw new Error("Could not discover OAuth token endpoint");
    }

    const secret = decryptRemoteToken(fresh.oauthClientSecretEnc);
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: fresh.oauthClientId,
      client_secret: secret,
      resource: fresh.url,
    });
    if (fresh.oauthScopes?.trim()) {
      body.set("scope", fresh.oauthScopes.trim());
    }

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `client_credentials token request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    const tokens = (await res.json()) as OAuthTokens;
    if (!tokens.access_token) {
      throw new Error("Token response missing access_token");
    }

    const [updated] = await tx
      .update(schema.mcpServers)
      .set({
        oauthTokensEnc: encryptJson(tokens),
        oauthTokenExpiresAt: tokenExpiresAt(tokens),
        status: "ok",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mcpServers.id, fresh.id))
      .returning();
    if (!updated) throw new Error("Failed to persist client_credentials tokens");
    return updated;
  });

  return locked;
}

function headersWithAuth(
  base: Record<string, string> | undefined,
  bearer: string | undefined,
): Record<string, string> | undefined {
  const headers = { ...(base ?? {}) };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Build a Mastra HTTP server definition. Always wires eventSourceInit when
 * headers exist so SSE-fallback requests carry the same auth.
 */
export function buildServerDefinition(
  row: McpServerRow,
  headers?: Record<string, string>,
  authProvider?: OAuthClientProvider,
): MastraMCPServerDefinition {
  const url = new URL(row.url);
  if (row.transport === "sse" && !url.pathname.endsWith("/sse")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/sse`;
  }

  const def: MastraMCPServerDefinition = {
    url,
    timeout: CONNECT_TIMEOUT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };

  if (authProvider) {
    def.authProvider = authProvider;
  }

  if (headers && Object.keys(headers).length > 0) {
    def.requestInit = { headers };
    def.eventSourceInit = {
      fetch(input: Request | URL | string, init?: RequestInit) {
        const next = new Headers(init?.headers);
        for (const [key, value] of Object.entries(headers)) {
          next.set(key, value);
        }
        return fetch(input, { ...init, headers: next });
      },
    };
  }

  return def;
}

async function resolveAuthForServer(
  db: Database,
  row: McpServerRow,
  userId: string,
): Promise<{
  row: McpServerRow;
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
}> {
  switch (row.authType) {
    case "none":
      return { row };
    case "headers": {
      if (!row.headersEnc) return { row };
      const headers = decryptJson<Record<string, string>>(row.headersEnc);
      return { row, headers };
    }
    case "oauth2_client_credentials": {
      const refreshed = await ensureClientCredentialsToken(db, row);
      const tokens = refreshed.oauthTokensEnc
        ? decryptJson<OAuthTokens>(refreshed.oauthTokensEnc)
        : null;
      if (!tokens?.access_token) {
        throw new Error("No access token available for client_credentials");
      }
      return {
        row: refreshed,
        headers: headersWithAuth(undefined, tokens.access_token),
      };
    }
    case "oauth2_auth_code": {
      const userAuth = await getOrCreateUserAuth(db, row.id, userId);
      if (!userAuth.oauthTokensEnc) {
        throw new UnauthorizedError("User has not authorized this MCP server");
      }
      return {
        row,
        authProvider: new DbOAuthClientProvider(db, row, userAuth),
      };
    }
    default:
      return { row };
  }
}

function onceDisconnect(clients: MCPClient[]): () => Promise<void> {
  let done: Promise<void> | null = null;
  return () => {
    if (!done) {
      done = Promise.allSettled(clients.map((c) => c.disconnect())).then(() => undefined);
    }
    return done;
  };
}

async function markServerStatus(
  db: Database,
  id: string,
  patch: Partial<typeof schema.mcpServers.$inferInsert>,
): Promise<void> {
  await db
    .update(schema.mcpServers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.mcpServers.id, id));
}

async function markUserAuthStatus(
  db: Database,
  serverId: string,
  userId: string,
  patch: Partial<typeof schema.mcpUserAuths.$inferInsert>,
): Promise<void> {
  await db
    .update(schema.mcpUserAuths)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.mcpUserAuths.mcpServerId, serverId),
        eq(schema.mcpUserAuths.userId, userId),
      ),
    );
}

/** Effective status for a user (auth-code uses per-user row; others use server). */
export async function userMcpStatus(
  db: Database,
  row: Pick<McpServerRow, "id" | "authType" | "status">,
  userId: string,
): Promise<McpServerRow["status"]> {
  if (row.authType !== "oauth2_auth_code") return row.status;
  const authRow = await db.query.mcpUserAuths.findFirst({
    where: and(
      eq(schema.mcpUserAuths.mcpServerId, row.id),
      eq(schema.mcpUserAuths.userId, userId),
    ),
    columns: { status: true, oauthTokensEnc: true },
  });
  if (!authRow?.oauthTokensEnc) return "needs_auth";
  return authRow.status;
}

/** Connect to one server as a specific user, list tools, persist health. */
export async function testMcpServerConnection(
  db: Database,
  row: McpServerRow,
  userId: string,
): Promise<{ ok: boolean; tools?: string[]; error?: string; needsAuth?: boolean }> {
  let client: MCPClient | null = null;
  try {
    const resolved = await resolveAuthForServer(db, row, userId);
    const def = buildServerDefinition(resolved.row, resolved.headers, resolved.authProvider);
    client = new MCPClient({
      id: `mcp-test-${row.id}-${randomBytes(8).toString("hex")}`,
      servers: { [row.slug]: def },
      timeout: CONNECT_TIMEOUT_MS,
    });
    const tools = await client.listTools();
    const toolNames = Object.keys(tools).map((k) => {
      const prefix = `${row.slug}_`;
      return k.startsWith(prefix) ? k.slice(prefix.length) : k;
    });
    await markServerStatus(db, row.id, {
      status: "ok",
      lastError: null,
      lastCheckedAt: new Date(),
      toolNames,
    });
    if (row.authType === "oauth2_auth_code") {
      await getOrCreateUserAuth(db, row.id, userId);
      await markUserAuthStatus(db, row.id, userId, {
        status: "ok",
        lastError: null,
        lastCheckedAt: new Date(),
      });
    }
    return { ok: true, tools: toolNames };
  } catch (err) {
    const needsAuth = err instanceof UnauthorizedError;
    const message = err instanceof Error ? err.message : String(err);
    if (row.authType === "oauth2_auth_code") {
      await getOrCreateUserAuth(db, row.id, userId);
      await markUserAuthStatus(db, row.id, userId, {
        status: needsAuth ? "needs_auth" : "error",
        lastError: message.slice(0, 2000),
        lastCheckedAt: new Date(),
      });
    } else {
      await markServerStatus(db, row.id, {
        status: needsAuth ? "needs_auth" : "error",
        lastError: message.slice(0, 2000),
        lastCheckedAt: new Date(),
      });
    }
    return { ok: false, error: message, needsAuth };
  } finally {
    if (client) {
      await client.disconnect().catch(() => undefined);
    }
  }
}

/** Begin auth-code flow for a specific user. */
export async function startMcpOauth(
  db: Database,
  row: McpServerRow,
  userId: string,
  returnTo?: string,
): Promise<{ authorizationUrl: string }> {
  if (row.authType !== "oauth2_auth_code") {
    throw new Error("Server is not configured for OAuth authorization code");
  }

  const state = randomBytes(32).toString("hex");
  const pendingExpires = new Date(Date.now() + OAUTH_PENDING_TTL_MS);
  const safeReturn = sanitizeReturnTo(returnTo);

  await getOrCreateUserAuth(db, row.id, userId);
  const [updated] = await db
    .update(schema.mcpUserAuths)
    .set({
      oauthPendingState: state,
      oauthPendingVerifierEnc: null,
      oauthPendingExpiresAt: pendingExpires,
      oauthReturnTo: safeReturn,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.mcpUserAuths.mcpServerId, row.id),
        eq(schema.mcpUserAuths.userId, userId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to persist OAuth pending state");

  // Refresh server row (DCR client info may change during auth).
  const server =
    (await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, row.id) })) ?? row;

  const provider = new DbOAuthClientProvider(db, server, updated);
  const result = await auth(provider, {
    serverUrl: server.url,
    scope: server.oauthScopes?.trim() || undefined,
  });

  if (result === "AUTHORIZED") {
    return { authorizationUrl: "" };
  }

  if (!provider.authorizationUrl) {
    throw new Error("OAuth flow did not produce an authorization URL");
  }
  return { authorizationUrl: provider.authorizationUrl.toString() };
}

/**
 * Complete auth-code callback. Looks up the pending per-user row by state.
 * Clears pending fields before exchanging so the state is single-use.
 */
export async function completeMcpOauth(
  db: Database,
  serverId: string,
  code: string,
  state: string,
): Promise<
  | { ok: true; returnTo: string; serverId: string }
  | { ok: false; errorCode: string; returnTo: string }
> {
  const server = await db.query.mcpServers.findFirst({
    where: eq(schema.mcpServers.id, serverId),
  });
  if (!server) {
    return { ok: false, errorCode: "not_found", returnTo: "/agents" };
  }

  const pending = await db.query.mcpUserAuths.findFirst({
    where: and(
      eq(schema.mcpUserAuths.mcpServerId, serverId),
      eq(schema.mcpUserAuths.oauthPendingState, state),
    ),
  });

  const returnTo = sanitizeReturnTo(pending?.oauthReturnTo);

  if (
    !pending ||
    !pending.oauthPendingExpiresAt ||
    pending.oauthPendingExpiresAt.getTime() < Date.now()
  ) {
    return { ok: false, errorCode: "expired", returnTo };
  }
  if (!safeEqualString(pending.oauthPendingState!, state)) {
    return { ok: false, errorCode: "invalid_state", returnTo };
  }

  const verifierEnc = pending.oauthPendingVerifierEnc;

  // Single-use: clear pending before exchange.
  const [cleared] = await db
    .update(schema.mcpUserAuths)
    .set({
      oauthPendingState: null,
      oauthPendingExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.mcpUserAuths.mcpServerId, pending.mcpServerId),
        eq(schema.mcpUserAuths.userId, pending.userId),
      ),
    )
    .returning();
  if (!cleared) {
    return { ok: false, errorCode: "server_error", returnTo };
  }

  const provider = new DbOAuthClientProvider(db, server, {
    ...cleared,
    oauthPendingVerifierEnc: verifierEnc,
  });

  try {
    await auth(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      scope: server.oauthScopes?.trim() || undefined,
    });
    await db
      .update(schema.mcpUserAuths)
      .set({
        oauthPendingVerifierEnc: null,
        oauthReturnTo: null,
        status: "ok",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mcpUserAuths.mcpServerId, pending.mcpServerId),
          eq(schema.mcpUserAuths.userId, pending.userId),
        ),
      );
    return { ok: true, returnTo, serverId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.mcpUserAuths)
      .set({
        oauthPendingVerifierEnc: null,
        oauthReturnTo: null,
        status: "needs_auth",
        lastError: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mcpUserAuths.mcpServerId, pending.mcpServerId),
          eq(schema.mcpUserAuths.userId, pending.userId),
        ),
      );
    return { ok: false, errorCode: "exchange_failed", returnTo };
  }
}

export type SessionMcpToolsResult = {
  tools: Record<string, unknown>;
  warnings: string[];
  disconnect: () => Promise<void>;
};

/** Load tools from enabled MCP servers attached to a session, as the session owner. */
export async function loadSessionMcpTools(
  db: Database,
  sessionId: string,
  userId: string,
  log: LogLike,
): Promise<SessionMcpToolsResult> {
  const attachments = await db.query.agentSessionMcpServers.findMany({
    where: eq(schema.agentSessionMcpServers.sessionId, sessionId),
    with: { mcpServer: true },
  });

  const servers = attachments
    .map((a) => a.mcpServer)
    .filter((s): s is McpServerRow => !!s && s.enabled);

  if (servers.length === 0) {
    return { tools: {}, warnings: [], disconnect: async () => undefined };
  }

  const clients: MCPClient[] = [];
  const tools: Record<string, unknown> = {};
  const warnings: string[] = [];
  const disconnect = onceDisconnect(clients);

  for (const row of servers) {
    try {
      const resolved = await resolveAuthForServer(db, row, userId);
      const def = buildServerDefinition(resolved.row, resolved.headers, resolved.authProvider);
      const client = new MCPClient({
        id: `mcp-${sessionId}-${row.id}-${randomBytes(8).toString("hex")}`,
        servers: { [row.slug]: def },
        timeout: CONNECT_TIMEOUT_MS,
      });
      clients.push(client);

      let listed: Record<string, unknown>;
      try {
        listed = (await client.listTools()) as Record<string, unknown>;
      } catch (err) {
        const needsAuth = err instanceof UnauthorizedError;
        const message = err instanceof Error ? err.message : String(err);
        if (row.authType === "oauth2_auth_code") {
          await getOrCreateUserAuth(db, row.id, userId);
          await markUserAuthStatus(db, row.id, userId, {
            status: needsAuth ? "needs_auth" : "error",
            lastError: message.slice(0, 2000),
            lastCheckedAt: new Date(),
          });
        } else {
          await markServerStatus(db, row.id, {
            status: needsAuth ? "needs_auth" : "error",
            lastError: message.slice(0, 2000),
            lastCheckedAt: new Date(),
          });
        }
        warnings.push(
          needsAuth
            ? `MCP server "${row.slug}" needs your authorization — Connect in the session or on New task.`
            : `MCP server "${row.slug}" unavailable: ${message}`,
        );
        log.warn({ err, serverId: row.id, slug: row.slug, userId }, "mcp listTools failed");
        continue;
      }

      for (const [name, tool] of Object.entries(listed)) {
        try {
          if (!tool || typeof tool !== "object") continue;
          tools[name] = tool;
        } catch (err) {
          log.warn({ err, tool: name, slug: row.slug }, "skipping malformed MCP tool");
        }
      }

      await markServerStatus(db, row.id, {
        lastCheckedAt: new Date(),
        toolNames: Object.keys(listed).map((k) => {
          const prefix = `${row.slug}_`;
          return k.startsWith(prefix) ? k.slice(prefix.length) : k;
        }),
        ...(row.authType !== "oauth2_auth_code"
          ? { status: "ok" as const, lastError: null }
          : {}),
      });
      if (row.authType === "oauth2_auth_code") {
        await markUserAuthStatus(db, row.id, userId, {
          status: "ok",
          lastError: null,
          lastCheckedAt: new Date(),
        });
      }
    } catch (err) {
      const needsAuth = err instanceof UnauthorizedError;
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(
        needsAuth
          ? `MCP server "${row.slug}" needs your authorization — Connect before chatting.`
          : `MCP server "${row.slug}" unavailable: ${message}`,
      );
      log.warn({ err, serverId: row.id, slug: row.slug, userId }, "mcp server setup failed");
      if (row.authType === "oauth2_auth_code") {
        await getOrCreateUserAuth(db, row.id, userId).catch(() => undefined);
        await markUserAuthStatus(db, row.id, userId, {
          status: needsAuth ? "needs_auth" : "error",
          lastError: message.slice(0, 2000),
          lastCheckedAt: new Date(),
        }).catch(() => undefined);
      } else {
        await markServerStatus(db, row.id, {
          status: needsAuth ? "needs_auth" : "error",
          lastError: message.slice(0, 2000),
          lastCheckedAt: new Date(),
        }).catch(() => undefined);
      }
    }
  }

  return { tools, warnings, disconnect };
}

/** Clear shared + per-user OAuth state when URL or auth type changes. */
export async function resetMcpAuthState(db: Database, serverId: string): Promise<void> {
  await db.delete(schema.mcpUserAuths).where(eq(schema.mcpUserAuths.mcpServerId, serverId));
}

/** Drop shared DCR client + all per-user tokens (everyone must Connect again). */
export async function clearMcpOauthClientRegistration(
  db: Database,
  serverId: string,
): Promise<void> {
  await db
    .update(schema.mcpServers)
    .set({
      oauthClientInfoEnc: null,
      oauthClientId: null,
      status: "needs_auth",
      lastError: null,
      toolNames: null,
      lastCheckedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.mcpServers.id, serverId));
  await resetMcpAuthState(db, serverId);
}

export function authResetFields(): Partial<typeof schema.mcpServers.$inferInsert> {
  return {
    oauthTokensEnc: null,
    oauthTokenExpiresAt: null,
    oauthClientInfoEnc: null,
    oauthPendingState: null,
    oauthPendingVerifierEnc: null,
    oauthPendingExpiresAt: null,
    status: "unknown",
    lastError: null,
    toolNames: null,
    lastCheckedAt: null,
  };
}
