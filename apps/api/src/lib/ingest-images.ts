import { randomUUID } from "node:crypto";

import { bundleGitPathPrefix, type GitEngine } from "@kherad/core/git";

const DATA_URI_RE = /!\[([^\]]*)\]\((data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\)/g;

const EXT_BY_MIME: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  "svg+xml": "svg",
  bmp: "bmp",
  avif: "avif",
};

/**
 * Uploads `data:` image URIs embedded in converted markdown into the bundle's
 * `_assets/` tree and rewrites markdown links to `/api/assets/...`.
 */
export async function rewriteEmbeddedImages(
  git: GitEngine,
  opts: {
    bundleSlug: string;
    branch: string;
    markdown: string;
    author: { name: string; email: string };
  },
): Promise<string> {
  const matches = [...opts.markdown.matchAll(DATA_URI_RE)];
  if (matches.length === 0) return opts.markdown;

  let result = opts.markdown;
  const writes: { path: string; content: Buffer }[] = [];
  const replacements: { from: string; to: string }[] = [];

  for (const match of matches) {
    const full = match[0]!;
    const alt = match[1] ?? "";
    const mimeSubtype = (match[3] ?? "png").toLowerCase();
    const b64 = (match[4] ?? "").replace(/\s+/g, "");
    const ext = EXT_BY_MIME[mimeSubtype] ?? "png";
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) continue;

    const assetPath = `_assets/${randomUUID().slice(0, 8)}-ingest.${ext}`;
    writes.push({
      path: `${bundleGitPathPrefix(opts.bundleSlug)}/${assetPath}`,
      content: bytes,
    });
    const src = `/api/assets/${opts.bundleSlug}/${assetPath}`;
    replacements.push({
      from: full,
      to: `![${alt}](${src})`,
    });
  }

  if (writes.length === 0) return opts.markdown;

  await git.writeAndCommit(
    opts.branch,
    writes,
    `Upload ${writes.length} ingest asset${writes.length === 1 ? "" : "s"}`,
    opts.author,
  );

  for (const { from, to } of replacements) {
    result = result.replace(from, to);
  }
  return result;
}
