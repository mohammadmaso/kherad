import { normalizePagePath, resolvePagePath, userBranchName, type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull, isUuid } from "../lib/get-bundle";
import { allocatePagePath, upsertRawPage } from "../lib/page-alloc";
import { legacyPageGitPath, pageGitPath } from "../lib/wiki-paths";

export async function pageRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  async function getRawPageOrNull(bundleId: string, pageId: string) {
    if (!isUuid(pageId)) return undefined;
    return db.query.pages.findFirst({
      where: and(
        eq(schema.pages.id, pageId),
        eq(schema.pages.bundleId, bundleId),
        eq(schema.pages.source, "raw"),
      ),
    });
  }

  server.post<{
    Params: { bundleId: string };
    Body: { path: string; title: string; content: string };
  }>("/bundles/:bundleId/pages", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const { title, content = "" } = request.body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      return reply.code(400).send({ error: "Title is required" });
    }
    if (typeof content !== "string") {
      return reply.code(400).send({ error: "content must be a string" });
    }

    const basePath = resolvePagePath({ path: request.body.path, title });
    if (basePath === null) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    const path = await allocatePagePath(db, bundle.id, basePath);

    const allowed = await checkPermission(db, request.user, bundle, path, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const branch = await git.createUserBranch(user.id);
    await git.writeAndCommit(
      branch,
      [{ path: pageGitPath(bundle.slug, path), content }],
      `Create page: ${path}`,
      { name: user.displayName, email: user.email },
    );

    const page = await upsertRawPage(db, bundle.id, path, title.trim());

    reply.code(201);
    return page;
  });

  // The bundle's document list (dashboard/"real docs site" view): every
  // non-deleted page the caller can view, per-page since a path-prefix grant
  // can restrict (or a bundle-level grant can allow) only part of the tree.
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/pages",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const pages = await db.query.pages.findMany({
        where: and(
          eq(schema.pages.bundleId, bundle.id),
          eq(schema.pages.source, "raw"),
          eq(schema.pages.isDeleted, false),
        ),
        orderBy: (p, { asc }) => asc(p.path),
      });

      const visible = await Promise.all(
        pages.map(async (page) =>
          (await checkPermission(db, request.user, bundle, page.path, "view")) ? page : null,
        ),
      );

      return visible.filter((page): page is NonNullable<typeof page> => page !== null);
    },
  );

  server.get<{ Params: { bundleId: string; pageId: string } }>(
    "/bundles/:bundleId/pages/:pageId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const page = await getRawPageOrNull(bundle.id, request.params.pageId);
      if (!page || page.isDeleted) {
        return reply.code(404).send({ error: "Page not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, page.path, "view");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const userBranch = request.user ? userBranchName(request.user.id) : null;
      const branches = userBranch ? await git.listBranches() : [];
      const readRef =
        userBranch && branches.includes(userBranch) ? userBranch : bundle.defaultBranch;

      const [contentBytes, lastCommitAt] = await Promise.all([
        git.getSourcePageAtRef(readRef, bundle.slug, page.path),
        git.getLastCommitTimestamp(readRef),
      ]);

      return {
        ...page,
        branch: readRef,
        content: contentBytes ? new TextDecoder().decode(contentBytes) : "",
        lastCommitAt,
      };
    },
  );

  server.put<{
    Params: { bundleId: string; pageId: string };
    Body: { content: string };
  }>("/bundles/:bundleId/pages/:pageId/content", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const page = await getRawPageOrNull(bundle.id, request.params.pageId);
    if (!page || page.isDeleted) {
      return reply.code(404).send({ error: "Page not found" });
    }

    const content = request.body?.content;
    if (typeof content !== "string") {
      return reply.code(400).send({ error: "content must be a string" });
    }

    const allowed = await checkPermission(db, request.user, bundle, page.path, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const branch = await git.createUserBranch(user.id);
    const commitOid = await git.writeAndCommit(
      branch,
      [{ path: pageGitPath(bundle.slug, page.path), content }],
      `Update page: ${page.path}`,
      { name: user.displayName, email: user.email },
    );
    const updatedAt = await git.getLastCommitTimestamp(branch);

    return { commitOid, branch, updatedAt };
  });

  server.patch<{
    Params: { bundleId: string; pageId: string };
    Body: { newPath: string; newTitle?: string };
  }>("/bundles/:bundleId/pages/:pageId/rename", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const page = await getRawPageOrNull(bundle.id, request.params.pageId);
    if (!page || page.isDeleted) {
      return reply.code(404).send({ error: "Page not found" });
    }

    const { newTitle } = request.body ?? {};
    if (typeof request.body?.newPath !== "string") {
      return reply.code(400).send({ error: "newPath is required" });
    }
    const newPath = normalizePagePath(request.body.newPath);
    if (newPath === null) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    if (newPath === page.path) {
      return reply.code(400).send({ error: "New path is the same as the current path" });
    }

    // The target must be free before anything is committed to git — hitting
    // the (bundleId, source, path) unique index after the git write would
    // leave the branch renamed but Postgres not.
    const occupant = await db.query.pages.findFirst({
      where: and(
        eq(schema.pages.bundleId, bundle.id),
        eq(schema.pages.source, "raw"),
        eq(schema.pages.path, newPath),
      ),
      columns: { id: true, isDeleted: true },
    });
    if (occupant && !occupant.isDeleted) {
      return reply.code(409).send({ error: "A page already exists at the new path" });
    }

    const [canEditOld, canEditNew] = await Promise.all([
      checkPermission(db, request.user, bundle, page.path, "edit"),
      checkPermission(db, request.user, bundle, newPath, "edit"),
    ]);
    if (!canEditOld || !canEditNew) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const branch = await git.createUserBranch(user.id);
    const oldGitPath = pageGitPath(bundle.slug, page.path);
    const newGitPath = pageGitPath(bundle.slug, newPath);

    const existingContent = await git.getSourcePageAtRef(branch, bundle.slug, page.path);
    if (existingContent === null) {
      return reply.code(409).send({ error: "Page content not found on your branch" });
    }

    await git.writeAndCommit(
      branch,
      [
        { path: oldGitPath, content: null },
        { path: newGitPath, content: existingContent },
      ],
      `Rename page: ${page.path} -> ${newPath}`,
      { name: user.displayName, email: user.email },
    );

    const updated = await db.transaction(async (tx) => {
      // A tombstone left at the target by an earlier delete/rename would
      // collide with the unique index — the live page supersedes it.
      if (occupant) {
        await tx.delete(schema.pages).where(eq(schema.pages.id, occupant.id));
      }
      const [row] = await tx
        .update(schema.pages)
        .set({ path: newPath, title: newTitle ?? page.title })
        .where(eq(schema.pages.id, page.id))
        .returning();

      await tx.insert(schema.pages).values({
        bundleId: bundle.id,
        path: page.path,
        title: page.title,
        isDeleted: true,
        redirectTo: newPath,
      });
      return row;
    });

    return updated;
  });

  server.delete<{ Params: { bundleId: string; pageId: string } }>(
    "/bundles/:bundleId/pages/:pageId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const page = await getRawPageOrNull(bundle.id, request.params.pageId);
      if (!page || page.isDeleted) {
        return reply.code(404).send({ error: "Page not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, page.path, "edit");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const user = request.user!;

      // Also remove the file from the author's branch (mirroring rename's
      // delete-old-path commit) so the deletion reaches main via the normal
      // MR flow. Leaving the blob in git kept deleted content alive in OKF
      // compiles and remote mirrors, and `reconcileRawPagesFromGit` (remote
      // pull / version restore) would resurrect the soft-deleted row.
      const branch = await git.createUserBranch(user.id);
      await git.writeAndCommit(
        branch,
        [
          { path: pageGitPath(bundle.slug, page.path), content: null },
          { path: legacyPageGitPath(bundle.slug, page.path), content: null },
        ],
        `Delete page: ${page.path}`,
        { name: user.displayName, email: user.email },
      );

      const [updated] = await db
        .update(schema.pages)
        .set({ isDeleted: true })
        .where(eq(schema.pages.id, page.id))
        .returning();

      return updated;
    },
  );
}
