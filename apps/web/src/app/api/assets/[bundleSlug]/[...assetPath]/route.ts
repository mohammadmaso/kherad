import { bundleGitPathPrefix, defaultGitEngine, userBranchName } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema } from "@kherad/db";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

/**
 * Serves git-stored image assets to plain `<img>` tags. `<img>` can't carry
 * the bearer Authorization header, but it does send cookies — so this
 * same-origin route authenticates via the mirrored session cookie (see
 * `setToken` in api-client) and reads the bare repo directly, preferring the
 * viewer's own branch like the page-content endpoint does.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bundleSlug: string; assetPath: string[] }> },
) {
  const { bundleSlug, assetPath } = await params;
  if (assetPath.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  const relativePath = assetPath.join("/");
  const ext = relativePath.split(".").pop()?.toLowerCase();
  const mimeType = ext ? IMAGE_MIME_TYPES[ext] : undefined;
  if (!mimeType) {
    return Response.json({ error: "Not an image asset" }, { status: 400 });
  }

  const bundle = await db.query.bundles.findFirst({
    where: eq(schema.bundles.slug, bundleSlug),
  });
  if (!bundle) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getSessionUser(request);
  const allowed = await checkPermission(db, user, bundle, relativePath, "view");
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const git = defaultGitEngine();
  const modernPath = `${bundleGitPathPrefix(bundleSlug)}/${relativePath}`;
  const legacyPath = `wiki/${bundleSlug}/${relativePath}`;
  const okfPath = `okf/${bundleSlug}/${relativePath}`;

  const userBranch = user ? userBranchName(user.id) : null;
  const branches = userBranch ? await git.listBranches() : [];
  const readRef = userBranch && branches.includes(userBranch) ? userBranch : bundle.defaultBranch;

  async function readAsset(ref: string): Promise<Uint8Array | null> {
    return (
      (await git.getFileAtRef(ref, modernPath)) ??
      (await git.getFileAtRef(ref, legacyPath)) ??
      (await git.getFileAtRef(ref, okfPath))
    );
  }

  let bytes = await readAsset(readRef);
  if (bytes === null && readRef !== bundle.defaultBranch) {
    bytes = await readAsset(bundle.defaultBranch);
  }
  if (bytes === null) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mimeType,
      // Content differs per viewer (branch preference), so keep it private.
      "Cache-Control": "private, max-age=60",
    },
  });
}
