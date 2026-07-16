import { randomUUID } from "node:crypto";

import { bundleGitPathPrefix, type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import type { Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull } from "../lib/get-bundle";

const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "avif",
]);
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
// Base64 inflates by 4/3; leave headroom over MAX_ASSET_BYTES for the JSON envelope.
const UPLOAD_BODY_LIMIT = 15 * 1024 * 1024;

/** `photo of me.PNG` -> `photo-of-me.png`; keeps the extension for mime detection. */
function safeAssetName(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  const base = filename
    .slice(0, dot)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${base || "image"}.${ext}`;
}

export async function assetRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // Uploads a binary image into the bundle's git subtree (on the uploader's
  // user branch, like any other content write). Served back to browsers by
  // the web app's cookie-authed `/api/assets/...` route, whose URL is what
  // gets embedded in the page markdown.
  server.post<{
    Params: { bundleId: string };
    Body: { filename: string; dataBase64: string };
  }>("/bundles/:bundleId/assets", { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const { filename, dataBase64 } = request.body ?? {};
    if (typeof filename !== "string" || typeof dataBase64 !== "string") {
      return reply.code(400).send({ error: "filename and dataBase64 are required" });
    }
    const safeName = safeAssetName(filename);
    if (!safeName) {
      return reply.code(400).send({ error: "Unsupported file type" });
    }

    const assetPath = `_assets/${randomUUID().slice(0, 8)}-${safeName}`;
    const allowed = await checkPermission(db, request.user, bundle, assetPath, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.byteLength === 0) {
      return reply.code(400).send({ error: "Empty file" });
    }
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      return reply.code(413).send({ error: "File too large (max 10 MB)" });
    }

    const branch = await git.createUserBranch(user.id);
    await git.writeAndCommit(
      branch,
      [{ path: `${bundleGitPathPrefix(bundle.slug)}/${assetPath}`, content: bytes }],
      `Upload asset: ${assetPath}`,
      { name: user.displayName, email: user.email },
    );

    reply.code(201);
    return {
      path: assetPath,
      src: `/api/assets/${bundle.slug}/${assetPath}`,
    };
  });
}
