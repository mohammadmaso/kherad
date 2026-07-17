import { checkPermission } from "@kherad/core/permissions";
import { schema } from "@kherad/db";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "../../../lib/auth";
import { db } from "../../../lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getPageWithBundle(pageId: string) {
  // Binding a non-UUID to the uuid column makes Postgres throw (a 500);
  // treat malformed ids as plain "not found".
  if (!UUID_RE.test(pageId)) return undefined;
  return db.query.pages.findFirst({
    where: eq(schema.pages.id, pageId),
    with: { bundle: true },
  });
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageId = request.nextUrl.searchParams.get("pageId");
  if (!pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  const page = await getPageWithBundle(pageId);
  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const allowed = await checkPermission(db, user, page.bundle, page.path, "edit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const draft = await db.query.autosaveDrafts.findFirst({
    where: and(eq(schema.autosaveDrafts.userId, user.id), eq(schema.autosaveDrafts.pageId, pageId)),
  });

  return NextResponse.json({ draft: draft ?? null });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    pageId?: unknown;
    contentJson?: unknown;
  } | null;
  const pageId = body?.pageId;
  const contentJson = body?.contentJson;
  if (typeof pageId !== "string" || contentJson === undefined) {
    return NextResponse.json({ error: "pageId and contentJson are required" }, { status: 400 });
  }

  const page = await getPageWithBundle(pageId);
  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  const allowed = await checkPermission(db, user, page.bundle, page.path, "edit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [draft] = await db
    .insert(schema.autosaveDrafts)
    .values({ userId: user.id, pageId, contentJson, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.autosaveDrafts.userId, schema.autosaveDrafts.pageId],
      set: { contentJson, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({ draft });
}
