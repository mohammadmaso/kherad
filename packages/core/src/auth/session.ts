import type { Database } from "@kherad/db";
import { schema } from "@kherad/db";
import { eq } from "drizzle-orm";

import { signAccessToken, verifyAccessToken } from "./jwt";
import { verifyPassword } from "./password";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Name of the httpOnly cookie apps/web mirrors the bearer token into, for SSR-side `getSession` lookups. */
export const SESSION_COOKIE_NAME = "kherad_session";

/** UI languages the product ships. Persian renders right-to-left. */
export const SUPPORTED_LOCALES = ["en", "fa"] as const;
export type UserLocale = (typeof SUPPORTED_LOCALES)[number];

export function isUserLocale(value: unknown): value is UserLocale {
  return SUPPORTED_LOCALES.includes(value as UserLocale);
}

export type AuthedUser = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  locale: UserLocale;
};

export type LoginResult = {
  user: AuthedUser;
  token: string;
};

function toAuthedUser(user: typeof schema.users.$inferSelect): AuthedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    locale: isUserLocale(user.locale) ? user.locale : "en",
  };
}

/** Persists a user's UI preferences; returns the updated user or null if the id is unknown. */
export async function updateUserPreferences(
  db: Database,
  userId: string,
  preferences: { locale: UserLocale },
): Promise<AuthedUser | null> {
  const [user] = await db
    .update(schema.users)
    .set({ locale: preferences.locale })
    .where(eq(schema.users.id, userId))
    .returning();
  return user ? toAuthedUser(user) : null;
}

export async function login(
  db: Database,
  email: string,
  password: string,
): Promise<LoginResult | null> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) return null;
  // Machine accounts (e.g. the OKF indexer) can never log in, regardless of password.
  if (user.isSystem) return null;

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;

  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const [session] = await db
    .insert(schema.sessions)
    .values({ userId: user.id, expiresAt })
    .returning();

  if (!session) {
    throw new Error("Failed to create session");
  }

  const token = await signAccessToken(
    { sub: user.id, jti: session.id, isAdmin: user.isAdmin },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return { user: toAuthedUser(user), token };
}

export async function logout(db: Database, token: string): Promise<void> {
  const payload = await verifyAccessToken(token).catch(() => null);
  if (!payload) return;

  await db.delete(schema.sessions).where(eq(schema.sessions.id, payload.jti));
}

export async function getSession(db: Database, token: string): Promise<AuthedUser | null> {
  const payload = await verifyAccessToken(token).catch(() => null);
  if (!payload) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, payload.jti),
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, payload.sub) });
  if (!user) return null;

  return toAuthedUser(user);
}

export function requireRole(user: AuthedUser | null, role: "admin"): boolean {
  if (!user) return false;
  if (role === "admin") return user.isAdmin;
  return false;
}
