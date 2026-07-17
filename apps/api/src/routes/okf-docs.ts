import {
  okfDocGitPath,
  okfDocSitePath,
  okfGitPathPrefix,
  userBranchName,
  type GitEngine,
} from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import type { Database } from "@kherad/db";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull } from "../lib/get-bundle";
import { READONLY_DOCS, requireFrontmatterType, validateDocPath } from "../lib/okf-doc";

const decoder = new TextDecoder();

/** Pull a display title out of OKF YAML frontmatter when present (mirrors the web app's version). */
function titleFromOkfMarkdown(markdown: string, fallback: string): string {
  if (!markdown.startsWith("---")) return fallback;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return fallback;
  const fm = markdown.slice(3, end);
  const match = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
  return match?.[1]?.trim() || fallback;
}

function prettifySegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

/** Resolves a site-relative doc path (query param, no `.md`) into a validated bundle-relative `.md` path, or null if invalid. */
function resolveDocPath(sitePath: string): string | null {
  return validateDocPath(`${sitePath}.md`);
}

export async function okfDocRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // Folder-tree listing for the bundle workspace: every OKF doc the caller may view.
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/okf-docs",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      if (bundle.mode !== "llm_compiled") {
        return reply.code(409).send({ error: "Bundle is not in LLM-compiled mode" });
      }

      const prefix = okfGitPathPrefix(bundle.slug);
      const files = (await git.listFilesAtRef(bundle.defaultBranch, prefix)).filter((p) =>
        p.endsWith(".md"),
      );

      const docs = await Promise.all(
        files.map(async (gitPath) => {
          const docPath = gitPath.slice(prefix.length + 1);
          const sitePath = okfDocSitePath(docPath);
          const allowed = await checkPermission(db, request.user, bundle, sitePath, "view");
          if (!allowed) return null;
          const bytes = await git.getFileAtRef(bundle.defaultBranch, gitPath);
          const markdown = bytes ? decoder.decode(bytes) : "";
          const fallback = prettifySegment(sitePath.split("/").pop() ?? sitePath);
          return {
            path: sitePath,
            title: titleFromOkfMarkdown(markdown, fallback),
            readonly: READONLY_DOCS.has(docPath),
          };
        }),
      );

      return docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null);
    },
  );

  server.get<{ Params: { bundleId: string }; Querystring: { path?: string } }>(
    "/bundles/:bundleId/okf-docs/content",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      if (bundle.mode !== "llm_compiled") {
        return reply.code(409).send({ error: "Bundle is not in LLM-compiled mode" });
      }

      const requestedPath = request.query.path;
      const docPath = typeof requestedPath === "string" ? resolveDocPath(requestedPath) : null;
      if (!docPath || typeof requestedPath !== "string") {
        return reply.code(400).send({ error: "Invalid or missing path" });
      }
      const sitePath = requestedPath;

      const allowed = await checkPermission(db, request.user, bundle, sitePath, "view");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      // Prefer the caller's own branch, but only when it actually carries this
      // doc — a user branch created before this path was last touched (or
      // before the bundle's first compile) has no `okf/<slug>` tree at all,
      // and `getFileAtRef` has no cross-branch fallback the way
      // `getSourcePageAtRef` does for raw pages.
      const gitPath = okfDocGitPath(bundle.slug, docPath);
      const userBranch = request.user ? userBranchName(request.user.id) : null;
      const branches = userBranch ? await git.listBranches() : [];
      let readRef = bundle.defaultBranch;
      let contentBytes: Uint8Array | null = null;
      if (userBranch && branches.includes(userBranch)) {
        contentBytes = await git.getFileAtRef(userBranch, gitPath);
        if (contentBytes !== null) readRef = userBranch;
      }
      if (contentBytes === null) {
        contentBytes = await git.getFileAtRef(bundle.defaultBranch, gitPath);
      }
      if (contentBytes === null) {
        return reply.code(404).send({ error: "Document not found" });
      }
      const lastCommitAt = await git.getLastCommitTimestamp(readRef);

      const canEdit =
        !READONLY_DOCS.has(docPath) &&
        (await checkPermission(db, request.user, bundle, sitePath, "edit"));

      return {
        path: sitePath,
        content: decoder.decode(contentBytes),
        branch: readRef,
        canEdit,
        lastCommitAt,
      };
    },
  );

  server.put<{
    Params: { bundleId: string };
    Querystring: { path?: string };
    Body: { content: string };
  }>("/bundles/:bundleId/okf-docs/content", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    if (bundle.mode !== "llm_compiled") {
      return reply.code(409).send({ error: "Bundle is not in LLM-compiled mode" });
    }

    const requestedPath = request.query.path;
    const docPath = typeof requestedPath === "string" ? resolveDocPath(requestedPath) : null;
    if (!docPath || typeof requestedPath !== "string") {
      return reply.code(400).send({ error: "Invalid or missing path" });
    }
    const sitePath = requestedPath;
    if (READONLY_DOCS.has(docPath)) {
      return reply.code(403).send({ error: "This document is system-generated and read-only" });
    }

    const content = request.body?.content;
    if (typeof content !== "string") {
      return reply.code(400).send({ error: "content must be a string" });
    }

    const frontmatterError = requireFrontmatterType(docPath, content);
    if (frontmatterError) {
      return reply.code(400).send({ error: frontmatterError });
    }

    const allowed = await checkPermission(db, request.user, bundle, sitePath, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const branch = await git.createUserBranch(user.id);
    const commitOid = await git.writeAndCommit(
      branch,
      [{ path: okfDocGitPath(bundle.slug, docPath), content }],
      `Update OKF document: ${docPath}`,
      { name: user.displayName, email: user.email },
    );
    const updatedAt = await git.getLastCommitTimestamp(branch);

    return { commitOid, branch, updatedAt };
  });
}
