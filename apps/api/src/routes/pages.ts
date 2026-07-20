import {
  bundleGitPathPrefix,
  folderGitKeepPath,
  folderPathFromGitKeep,
  normalizePagePath,
  resolvePagePath,
  slugifyPagePath,
  userBranchName,
  type GitEngine,
} from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull, isUuid } from "../lib/get-bundle";
import { allocatePagePath, upsertRawPage } from "../lib/page-alloc";
import { legacyPageGitPath, pageGitPath } from "../lib/wiki-paths";
import { writePageContent } from "../lib/write-page-content";

async function listFolderPathsAtRef(
  git: GitEngine,
  ref: string,
  bundleSlug: string,
): Promise<string[]> {
  const prefix = bundleGitPathPrefix(bundleSlug);
  const files = await git.listFilesAtRef(ref, prefix);
  const folders = new Set<string>();
  for (const gitPath of files) {
    const relative = gitPath.slice(prefix.length + 1);
    const folder = folderPathFromGitKeep(relative);
    if (folder) {
      const segments = folder.split("/");
      for (let i = 1; i <= segments.length; i++) {
        folders.add(segments.slice(0, i).join("/"));
      }
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

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

  /**
   * Create a directory without a document by committing `.gitkeep` on the
   * author's branch. Nested paths create the full tree; submit for review to
   * merge onto main.
   */
  server.post<{
    Params: { bundleId: string };
    Body: { path?: string };
  }>("/bundles/:bundleId/folders", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    if (!request.user) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const path = typeof request.body?.path === "string" ? slugifyPagePath(request.body.path) : null;
    if (!path) {
      return reply.code(400).send({ error: "Invalid path" });
    }

    const allowed = await checkPermission(db, request.user, bundle, path, "edit");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user;

    const branch = await git.createUserBranch(user.id);
    const keepPath = folderGitKeepPath(bundle.slug, path);
    const existing = await git.getFileAtRef(branch, keepPath);
    if (existing !== null) {
      return reply.code(409).send({ error: "Folder already exists", path });
    }

    await git.writeAndCommit(
      branch,
      [{ path: keepPath, content: "" }],
      `Create folder: ${path}`,
      { name: user.displayName, email: user.email },
    );

    reply.code(201);
    return { path };
  });

  /** Empty / placeholder folders visible on the author's branch (or main). */
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/folders",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const user = request.user;
      let ref = bundle.defaultBranch;
      if (user) {
        const branch = userBranchName(user.id);
        if ((await git.getRefOid(branch)) !== null) ref = branch;
      }

      const folders = await listFolderPathsAtRef(git, ref, bundle.slug);
      const visible = await Promise.all(
        folders.map(async (path) =>
          (await checkPermission(db, request.user, bundle, path, "view")) ? path : null,
        ),
      );
      return visible.filter((path): path is string => path !== null);
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

    const { commitOid, branch } = await writePageContent(
      git,
      bundle,
      page,
      content,
      user,
      `Update page: ${page.path}`,
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

  server.delete<{
    Params: { bundleId: string; pageId: string };
    Body: { confirmName?: string };
  }>("/bundles/:bundleId/pages/:pageId", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const page = await getRawPageOrNull(bundle.id, request.params.pageId);
    if (!page || page.isDeleted) {
      return reply.code(404).send({ error: "Page not found" });
    }

    const confirmName = request.body?.confirmName;
    if (typeof confirmName !== "string" || confirmName !== page.title) {
      return reply.code(400).send({
        error: "confirmName must match the document title exactly",
      });
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
  });

  // Soft-delete every raw page at/under a path prefix, and remove any
  // `.gitkeep` placeholders that hold empty directories. Requires typing the
  // folder's last path segment as confirmName.
  server.delete<{
    Params: { bundleId: string };
    Body: { pathPrefix?: string; confirmName?: string };
  }>("/bundles/:bundleId/folders", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    if (!request.user) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const rawPrefix = request.body?.pathPrefix;
    if (typeof rawPrefix !== "string") {
      return reply.code(400).send({ error: "pathPrefix is required" });
    }
    const pathPrefix = normalizePagePath(rawPrefix);
    if (pathPrefix === null) {
      return reply.code(400).send({ error: "Invalid pathPrefix" });
    }

    const folderName = pathPrefix.includes("/")
      ? pathPrefix.slice(pathPrefix.lastIndexOf("/") + 1)
      : pathPrefix;
    const confirmName = request.body?.confirmName;
    if (typeof confirmName !== "string" || confirmName !== folderName) {
      return reply.code(400).send({
        error: "confirmName must match the folder name exactly",
      });
    }

    const pages = await db.query.pages.findMany({
      where: and(
        eq(schema.pages.bundleId, bundle.id),
        eq(schema.pages.source, "raw"),
        eq(schema.pages.isDeleted, false),
        or(eq(schema.pages.path, pathPrefix), like(schema.pages.path, `${pathPrefix}/%`)),
      ),
    });

    const user = request.user;
    const branch = await git.createUserBranch(user.id);
    const prefix = bundleGitPathPrefix(bundle.slug);
    const gitFiles = await git.listFilesAtRef(branch, prefix);
    const keepFiles = gitFiles.filter((gitPath) => {
      const relative = gitPath.slice(prefix.length + 1);
      const folder = folderPathFromGitKeep(relative);
      return (
        folder !== null && (folder === pathPrefix || folder.startsWith(`${pathPrefix}/`))
      );
    });

    if (pages.length === 0 && keepFiles.length === 0) {
      return reply.code(404).send({ error: "Folder not found" });
    }

    const permissionPaths = [
      ...pages.map((page) => page.path),
      ...keepFiles.map((gitPath) => {
        const relative = gitPath.slice(prefix.length + 1);
        return folderPathFromGitKeep(relative)!;
      }),
      pathPrefix,
    ];
    const permissions = await Promise.all(
      [...new Set(permissionPaths)].map((path) =>
        checkPermission(db, request.user, bundle, path, "edit"),
      ),
    );
    if (permissions.some((allowed) => !allowed)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const files = [
      ...pages.flatMap((page) => [
        { path: pageGitPath(bundle.slug, page.path), content: null as string | null },
        { path: legacyPageGitPath(bundle.slug, page.path), content: null as string | null },
      ]),
      ...keepFiles.map((path) => ({ path, content: null as string | null })),
    ];
    await git.writeAndCommit(
      branch,
      files,
      `Delete folder: ${pathPrefix}`,
      { name: user.displayName, email: user.email },
    );

    if (pages.length > 0) {
      await db
        .update(schema.pages)
        .set({ isDeleted: true })
        .where(
          inArray(
            schema.pages.id,
            pages.map((page) => page.id),
          ),
        );
    }

    return { deleted: true, count: pages.length, pathPrefix };
  });

  /**
   * Rename a folder prefix: moves every page and `.gitkeep` under `pathPrefix`
   * to `newPath` on the author's branch, and updates Postgres with redirect
   * tombstones (same pattern as page rename).
   */
  server.post<{
    Params: { bundleId: string };
    Body: { pathPrefix?: string; newPath?: string };
  }>("/bundles/:bundleId/folders/rename", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    if (!request.user) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const rawOld =
      typeof request.body?.pathPrefix === "string"
        ? normalizePagePath(request.body.pathPrefix)
        : null;
    const rawNew =
      typeof request.body?.newPath === "string" ? slugifyPagePath(request.body.newPath) : null;
    if (!rawOld || !rawNew) {
      return reply.code(400).send({ error: "pathPrefix and newPath are required" });
    }
    const pathPrefix: string = rawOld;
    const newPath: string = rawNew;
    if (newPath === pathPrefix) {
      return reply.code(400).send({ error: "New path is the same as the current path" });
    }
    if (newPath.startsWith(`${pathPrefix}/`) || pathPrefix.startsWith(`${newPath}/`)) {
      return reply.code(400).send({ error: "Cannot rename a folder into itself" });
    }

    const pages = await db.query.pages.findMany({
      where: and(
        eq(schema.pages.bundleId, bundle.id),
        eq(schema.pages.source, "raw"),
        eq(schema.pages.isDeleted, false),
        or(eq(schema.pages.path, pathPrefix), like(schema.pages.path, `${pathPrefix}/%`)),
      ),
    });

    const user = request.user;
    const branch = await git.createUserBranch(user.id);
    const prefix = bundleGitPathPrefix(bundle.slug);
    const gitFiles = await git.listFilesAtRef(branch, prefix);
    const keepFiles = gitFiles.filter((gitPath) => {
      const relative = gitPath.slice(prefix.length + 1);
      const folder = folderPathFromGitKeep(relative);
      return folder !== null && (folder === pathPrefix || folder.startsWith(`${pathPrefix}/`));
    });

    if (pages.length === 0 && keepFiles.length === 0) {
      return reply.code(404).send({ error: "Folder not found" });
    }

    function remapPath(oldPath: string): string {
      if (oldPath === pathPrefix) return newPath;
      return `${newPath}${oldPath.slice(pathPrefix.length)}`;
    }

    const moves = pages.map((page) => ({ page, nextPath: remapPath(page.path) }));

    for (const { nextPath } of moves) {
      const occupant = await db.query.pages.findFirst({
        where: and(
          eq(schema.pages.bundleId, bundle.id),
          eq(schema.pages.source, "raw"),
          eq(schema.pages.path, nextPath),
          eq(schema.pages.isDeleted, false),
        ),
        columns: { id: true, path: true },
      });
      if (occupant && !moves.some((m) => m.page.id === occupant.id)) {
        return reply.code(409).send({
          error: `A page already exists at “${nextPath}”`,
        });
      }
    }

    const keepMoves = keepFiles.map((gitPath) => {
      const relative = gitPath.slice(prefix.length + 1);
      const folder = folderPathFromGitKeep(relative)!;
      const nextFolder = remapPath(folder);
      return {
        from: gitPath,
        to: folderGitKeepPath(bundle.slug, nextFolder),
        folder: nextFolder,
      };
    });

    for (const move of keepMoves) {
      if (gitFiles.includes(move.to) && !keepFiles.includes(move.to)) {
        return reply.code(409).send({
          error: `A folder already exists at “${move.folder}”`,
        });
      }
    }

    const permissionPaths = [
      pathPrefix,
      newPath,
      ...moves.flatMap(({ page, nextPath }) => [page.path, nextPath]),
      ...keepMoves.map((m) => m.folder),
    ];
    const permissions = await Promise.all(
      [...new Set(permissionPaths)].map((path) =>
        checkPermission(db, request.user, bundle, path, "edit"),
      ),
    );
    if (permissions.some((allowed) => !allowed)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const gitChanges: { path: string; content: string | null | Uint8Array }[] = [];
    for (const { page, nextPath } of moves) {
      const content = await git.getSourcePageAtRef(branch, bundle.slug, page.path);
      if (content === null) {
        return reply.code(409).send({
          error: `Page content not found on your branch: ${page.path}`,
        });
      }
      gitChanges.push(
        { path: pageGitPath(bundle.slug, page.path), content: null },
        { path: legacyPageGitPath(bundle.slug, page.path), content: null },
        { path: pageGitPath(bundle.slug, nextPath), content },
      );
    }
    for (const move of keepMoves) {
      gitChanges.push({ path: move.from, content: null }, { path: move.to, content: "" });
    }

    await git.writeAndCommit(
      branch,
      gitChanges,
      `Rename folder: ${pathPrefix} -> ${newPath}`,
      { name: user.displayName, email: user.email },
    );

    await db.transaction(async (tx) => {
      for (const { page, nextPath } of moves) {
        const occupant = await tx.query.pages.findFirst({
          where: and(
            eq(schema.pages.bundleId, bundle.id),
            eq(schema.pages.source, "raw"),
            eq(schema.pages.path, nextPath),
          ),
          columns: { id: true, isDeleted: true },
        });
        if (occupant) {
          await tx.delete(schema.pages).where(eq(schema.pages.id, occupant.id));
        }
        await tx
          .update(schema.pages)
          .set({ path: nextPath })
          .where(eq(schema.pages.id, page.id));
        await tx.insert(schema.pages).values({
          bundleId: bundle.id,
          path: page.path,
          title: page.title,
          isDeleted: true,
          redirectTo: nextPath,
        });
      }
    });

    return {
      pathPrefix,
      newPath,
      movedPages: moves.length,
      movedFolders: keepMoves.length,
    };
  });
}
