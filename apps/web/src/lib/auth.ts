import { getSession, SESSION_COOKIE_NAME, type AuthedUser } from "@kherad/core/auth";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { cache } from "react";

import { db } from "./db";

export async function getSessionUser(request: NextRequest): Promise<AuthedUser | null> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return getSession(db, header.slice("Bearer ".length));
  }
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) return getSession(db, cookieToken);
  return null;
}

/**
 * Server Component / Server Action auth: unlike Route Handlers, these only
 * ever see cookies (a browser navigation never carries a custom
 * Authorization header) — used by the SSR wiki renderer to identify the
 * viewer for `checkPermission`, including the anonymous case (`null`).
 * Wrapped in `cache` so layout and page share one session lookup per request
 * — and a reference-equal viewer, which `getWikiNav`'s own `cache` wrapper
 * needs to dedupe.
 */
export const getViewer = cache(async function getViewer(): Promise<AuthedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSession(db, token);
});
