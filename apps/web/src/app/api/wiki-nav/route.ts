import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "../../../lib/auth";
import { getWikiNavForVersion } from "../../../lib/wiki-nav";

/**
 * Sidebar tree for a wiki version snapshot. The sidebar is rendered by a
 * layout (which never sees `?version=`), so the client shell fetches the
 * version-scoped hierarchy here when a reader picks a version. Anonymous
 * viewers are fine — `getWikiNavForVersion` applies the same per-path "view"
 * permission filtering as the live sidebar.
 */
export async function GET(request: NextRequest) {
  const bundleSlug = request.nextUrl.searchParams.get("bundle");
  const version = request.nextUrl.searchParams.get("version");
  if (!bundleSlug || !version) {
    return NextResponse.json({ error: "bundle and version are required" }, { status: 400 });
  }

  const viewer = await getSessionUser(request);
  const nav = await getWikiNavForVersion(bundleSlug, viewer, version);
  if (!nav) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ tree: nav.tree, pageCount: nav.pageCount });
}
