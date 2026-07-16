import { ACCESS_TOKEN_TTL_SECONDS, SESSION_COOKIE_NAME } from "@kherad/core/auth";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Mirrors a bearer token (obtained from the API's `/auth/login`) into an
 * httpOnly cookie, per PRD §4 ("server-side sessions ... with an httpOnly
 * cookie, not JWT"). The token itself is still a JWT referencing a
 * revocable Postgres session row (`getSession` checks both), so this is
 * purely a transport change: Server Components can't read `localStorage`,
 * so SSR permission checks (Prompt 7) need the session reachable via cookie.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
