import {
  bundleGitPathPrefix,
  isImageAssetPath,
  isNotFoundError,
  MergeConflictDetectedError,
  okfDocSitePath,
  okfGitPathPrefix,
  userBranchName,
  wikiPathFromRawGitEntry,
  type GitEngine,
} from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { reconcileOkfSearchIndex, refreshSearchIndexForMerge } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { createEmbedder } from "../lib/embedder";
import { getBundleOrNull, isUuid } from "../lib/get-bundle";
import { guessImageMimeType } from "../lib/mime";
import { notifyMrSubmitted } from "./notifications";

function decode(bytes: Uint8Array | null): string | null {
  return bytes ? new TextDecoder().decode(bytes) : null;
}

const OPEN_STATUSES: (typeof schema.mergeRequestStatusEnum.enumValues)[number][] = [
  "draft",
  "open",
  "conflict",
];

function isOpenMrStatus(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Which subtree this MR's diff/merge is scoped to: human MRs touch the
 * bundle's source pages (`raw/<slug>`), indexer-agent MRs touch its compiled
 * OKF knowledge bundle (`okf/<slug>`).
 */
function mrPathPrefix(bundle: { slug: string }, mr: { scope: "wiki" | "okf" }): string {
  return mr.scope === "okf" ? okfGitPathPrefix(bundle.slug) : bundleGitPathPrefix(bundle.slug);
}

/**
 * Updates `search_index` after a merge. `"wiki"`-scope MRs happen often (every
 * page save) so they get the cheap beforeOid/afterOid diff path. `"okf"`-scope
 * MRs (indexer-agent compiles) are rare, so instead of diffing they get a full
 * reconcile of the bundle's current `okf/<slug>` tree — self-healing for docs
 * that predate this codepath or drifted from a partial past state.
 */
async function syncSearchIndex(
  db: Database,
  git: GitEngine,
  bundle: { id: string; slug: string; defaultBranch: string },
  mr: { scope: "wiki" | "okf" },
  beforeOid: string,
  afterOid: string,
): Promise<void> {
  const embedder = await createEmbedder(db);
  if (mr.scope === "okf") {
    await reconcileOkfSearchIndex(db, git, bundle, embedder);
  } else {
    await refreshSearchIndexForMerge(db, git, bundle, beforeOid, afterOid, embedder);
  }
}

async function getMrOrNull(db: Database, bundleId: string, mrId: string) {
  if (!isUuid(mrId)) return undefined;
  return db.query.mergeRequests.findFirst({
    where: and(eq(schema.mergeRequests.id, mrId), eq(schema.mergeRequests.bundleId, bundleId)),
  });
}

/**
 * Refs used for the reviewer diff / asset preview. Open MRs must track the
 * live author branch tip and current default branch — the stored
 * baseCommit/headCommit go stale as soon as the author saves again or main
 * moves, which made the UI show an old (sometimes already-merged) change
 * while approve still merged the live tip.
 */
async function resolveMrDiffRefs(
  git: GitEngine,
  mr: { status: string; branchName: string; baseCommit: string; headCommit: string },
  defaultBranch: string,
): Promise<{ baseRef: string; headRef: string }> {
  if (!isOpenMrStatus(mr.status)) {
    return { baseRef: mr.baseCommit, headRef: mr.headCommit };
  }
  const [liveHead, liveBase] = await Promise.all([
    git.getRefOid(mr.branchName),
    git.getRefOid(defaultBranch),
  ]);
  return {
    baseRef: liveBase ?? mr.baseCommit,
    headRef: liveHead ?? mr.headCommit,
  };
}

export async function mergeRequestRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // "Submit for review": packages the author's branch into an MR for this bundle.
  // Re-submitting while an MR is still open/in-conflict updates that same MR
  // rather than creating a new one, per PRD §3. `scope` lets a human edit to a
  // bundle's OKF docs (see okf-docs.ts) submit independently of any in-flight
  // "wiki"-scope MR on the same user branch — `mrPathPrefix` scopes the diff
  // and merge so the two never step on each other.
  server.post<{ Params: { bundleId: string }; Body: { scope?: "wiki" | "okf" } }>(
    "/bundles/:bundleId/merge-requests",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const scope = request.body?.scope === "okf" ? "okf" : "wiki";

      if (!request.user) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const user = request.user;
      const branchName = userBranchName(user.id);

      const branches = await git.listBranches();
      if (!branches.includes(branchName)) {
        return reply.code(400).send({ error: "Nothing to submit — you have no saved changes yet" });
      }

      const [headCommit, baseCommit] = await Promise.all([
        git.getRefOid(branchName),
        git.getRefOid(bundle.defaultBranch),
      ]);
      if (!headCommit || !baseCommit) {
        return reply.code(400).send({ error: "Could not resolve branch state" });
      }

      // A single bundle-level `edit` check (path: null) misses authors who
      // only hold a path-prefixed grant on the pages they actually touched —
      // per checkPermission's precedence rules a null path can only match a
      // bundle-level grant, so those authors were wrongly 403'd here even
      // though they may edit every page in this diff. Check each changed
      // page/doc's own path instead, same as every other route in this app.
      const prefix = mrPathPrefix(bundle, { scope });
      const changed = await git.diffRefs(baseCommit, headCommit, prefix);
      if (changed.length === 0) {
        return reply.code(400).send({ error: "Nothing to submit — you have no saved changes yet" });
      }
      const touchedPaths = changed.map((entry) => {
        const relative = entry.path.slice(prefix.length + 1);
        return scope === "okf" ? okfDocSitePath(relative) : wikiPathFromRawGitEntry(relative);
      });
      const permitted = await Promise.all(
        touchedPaths.map((path) => checkPermission(db, user, bundle, path, "edit")),
      );
      if (permitted.some((ok) => !ok)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const existing = await db.query.mergeRequests.findFirst({
        where: and(
          eq(schema.mergeRequests.bundleId, bundle.id),
          eq(schema.mergeRequests.authorId, user.id),
          eq(schema.mergeRequests.branchName, branchName),
          eq(schema.mergeRequests.scope, scope),
          inArray(schema.mergeRequests.status, OPEN_STATUSES),
        ),
        orderBy: desc(schema.mergeRequests.createdAt),
      });

      if (existing) {
        // Clear any stale conflict state — new changes since the last conflicting attempt.
        if (existing.status === "conflict") {
          await db.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, existing.id));
        }
        // Refresh both tips so the MR tracks current main and the author's
        // latest saved commit (not the commits from when it was first opened).
        const [updated] = await db
          .update(schema.mergeRequests)
          .set({
            status: "open",
            baseCommit,
            headCommit,
            updatedAt: new Date(),
          })
          .where(eq(schema.mergeRequests.id, existing.id))
          .returning();
        if (updated) await notifyMrSubmitted(db, bundle, updated, user.displayName);
        return updated;
      }

      const [created] = await db
        .insert(schema.mergeRequests)
        .values({
          bundleId: bundle.id,
          authorId: user.id,
          branchName,
          scope,
          status: "open",
          baseCommit,
          headCommit,
        })
        .returning();
      if (created) await notifyMrSubmitted(db, bundle, created, user.displayName);

      reply.code(201);
      return created;
    },
  );

  server.get<{ Params: { bundleId: string }; Querystring: { status?: string } }>(
    "/bundles/:bundleId/merge-requests",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const status = request.query.status as
        (typeof schema.mergeRequestStatusEnum.enumValues)[number] | undefined;

      return db.query.mergeRequests.findMany({
        where: status
          ? and(
              eq(schema.mergeRequests.bundleId, bundle.id),
              eq(schema.mergeRequests.status, status),
            )
          : eq(schema.mergeRequests.bundleId, bundle.id),
        orderBy: desc(schema.mergeRequests.updatedAt),
        with: { author: { columns: { id: true, displayName: true, email: true } } },
      });
    },
  );

  server.get<{ Params: { bundleId: string; mrId: string } }>(
    "/bundles/:bundleId/merge-requests/:mrId",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
      if (!mr) {
        return reply.code(404).send({ error: "Merge request not found" });
      }

      const isAuthor = request.user?.id === mr.authorId;
      const allowed = isAuthor || (await checkPermission(db, request.user, bundle, null, "review"));
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const { baseRef, headRef } = await resolveMrDiffRefs(git, mr, bundle.defaultBranch);

      let diff;
      try {
        diff = await git.diffRefs(baseRef, headRef, mrPathPrefix(bundle, mr));
      } catch (err) {
        if (!isNotFoundError(err)) throw err;
        return reply.code(500).send({
          error:
            "This merge request references commits that no longer exist in the repository. " +
            "This usually means the git storage backing the API changed underneath it — " +
            "re-submitting for review from the author's branch will fix it.",
        });
      }

      // Per-file content for the reviewer diff view (PRD §7): raw markdown
      // text on both sides of a change for jsdiff to diff client-side, or
      // asset URLs for a side-by-side image preview instead of inlining
      // binary content into the JSON response.
      const files = await Promise.all(
        diff.map(async (entry) => {
          if (isImageAssetPath(entry.path)) {
            const base = `/bundles/${bundle.id}/merge-requests/${mr.id}/asset?path=${encodeURIComponent(entry.path)}`;
            return {
              path: entry.path,
              status: entry.status,
              kind: "asset" as const,
              beforeUrl: entry.status !== "added" ? `${base}&side=before` : null,
              afterUrl: entry.status !== "deleted" ? `${base}&side=after` : null,
            };
          }

          const [beforeBytes, afterBytes] = await Promise.all([
            entry.status !== "added"
              ? git.getFileAtRef(baseRef, entry.path)
              : Promise.resolve(null),
            entry.status !== "deleted"
              ? git.getFileAtRef(headRef, entry.path)
              : Promise.resolve(null),
          ]);
          return {
            path: entry.path,
            status: entry.status,
            kind: "text" as const,
            before: decode(beforeBytes),
            after: decode(afterBytes),
          };
        }),
      );

      const [reviewers, author] = await Promise.all([
        db.query.mrReviewers.findMany({
          where: eq(schema.mrReviewers.mrId, mr.id),
          with: { user: { columns: { id: true, displayName: true, email: true } } },
        }),
        db.query.users.findFirst({
          where: eq(schema.users.id, mr.authorId),
          columns: { id: true, displayName: true, email: true },
        }),
      ]);

      return { ...mr, author, diff, files, reviewers };
    },
  );

  // Raw blob content for an image asset on either side of the diff (side-by-side viewer).
  server.get<{
    Params: { bundleId: string; mrId: string };
    Querystring: { path: string; side: "before" | "after" };
  }>("/bundles/:bundleId/merge-requests/:mrId/asset", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
    if (!mr) {
      return reply.code(404).send({ error: "Merge request not found" });
    }
    const isAuthor = request.user?.id === mr.authorId;
    const allowed = isAuthor || (await checkPermission(db, request.user, bundle, null, "review"));
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const { path, side } = request.query;
    // Only image assets inside this MR's own subtree — the ref spans the
    // whole repo, so an unscoped path would let any MR participant read
    // blobs from bundles they have no access to.
    const prefix = mrPathPrefix(bundle, mr);
    if (
      typeof path !== "string" ||
      !path.startsWith(`${prefix}/`) ||
      !isImageAssetPath(path) ||
      path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      return reply.code(400).send({ error: "Invalid asset path" });
    }
    const { baseRef, headRef } = await resolveMrDiffRefs(git, mr, bundle.defaultBranch);
    const ref = side === "before" ? baseRef : headRef;
    const bytes = await git.getFileAtRef(ref, path);
    if (bytes === null) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    reply.header("Content-Type", guessImageMimeType(path));
    return reply.send(Buffer.from(bytes));
  });

  // Inline comments anchored to a path/line (both null = a general MR comment).
  server.get<{ Params: { bundleId: string; mrId: string } }>(
    "/bundles/:bundleId/merge-requests/:mrId/comments",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }
      const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
      if (!mr) {
        return reply.code(404).send({ error: "Merge request not found" });
      }
      const isAuthor = request.user?.id === mr.authorId;
      const allowed = isAuthor || (await checkPermission(db, request.user, bundle, null, "review"));
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      return db.query.mrComments.findMany({
        where: eq(schema.mrComments.mrId, mr.id),
        with: { author: { columns: { id: true, displayName: true, email: true } } },
        orderBy: schema.mrComments.createdAt,
      });
    },
  );

  server.post<{
    Params: { bundleId: string; mrId: string };
    Body: { body: string; path?: string; line?: number };
  }>("/bundles/:bundleId/merge-requests/:mrId/comments", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }
    const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
    if (!mr) {
      return reply.code(404).send({ error: "Merge request not found" });
    }
    const isAuthor = request.user?.id === mr.authorId;
    const allowed = isAuthor || (await checkPermission(db, request.user, bundle, null, "review"));
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const user = request.user!;

    const { body, path = null, line = null } = request.body ?? {};
    if (typeof body !== "string" || !body.trim()) {
      return reply.code(400).send({ error: "Comment body is required" });
    }
    const [comment] = await db
      .insert(schema.mrComments)
      .values({ mrId: mr.id, authorId: user.id, body, path, line })
      .returning();

    reply.code(201);
    return comment;
  });

  server.post<{ Params: { bundleId: string; mrId: string } }>(
    "/bundles/:bundleId/merge-requests/:mrId/approve",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
      if (!mr) {
        return reply.code(404).send({ error: "Merge request not found" });
      }
      if (mr.status !== "open") {
        return reply.code(409).send({ error: `Merge request is '${mr.status}', not 'open'` });
      }

      const currentHead = await git.getRefOid(mr.branchName);
      if (!currentHead) {
        return reply.code(409).send({ error: "Author branch no longer exists" });
      }

      try {
        const beforeOid = await git.getRefOid(bundle.defaultBranch);
        const result = await git.squashMerge(
          mr.branchName,
          bundle.defaultBranch,
          `Merge request ${mr.id}`,
          mrPathPrefix(bundle, mr),
        );
        if (result.alreadyMerged) {
          // Keep the MR open — marking it merged with a no-op made the UI
          // look successful while the wiki never changed (and the next
          // submit reused a confusing "already applied" diff).
          await db
            .update(schema.mergeRequests)
            .set({ headCommit: currentHead, updatedAt: new Date() })
            .where(eq(schema.mergeRequests.id, mr.id));
          return reply.code(409).send({
            error:
              "Nothing new to merge — this bundle already matches the author's branch. " +
              "Save new edits and submit for review again.",
          });
        }
        if (beforeOid) {
          await syncSearchIndex(db, git, bundle, mr, beforeOid, result.oid);
        }
        const [updated] = await db
          .update(schema.mergeRequests)
          .set({
            status: "merged",
            baseCommit: beforeOid ?? mr.baseCommit,
            headCommit: currentHead,
            updatedAt: new Date(),
          })
          .where(eq(schema.mergeRequests.id, mr.id))
          .returning();
        return { ...updated, merged: true };
      } catch (err) {
        if (!(err instanceof MergeConflictDetectedError)) throw err;

        await db.transaction(async (tx) => {
          await tx.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, mr.id));
          await tx.insert(schema.mrConflicts).values(
            err.files.map((file) => ({
              mrId: mr.id,
              path: file.path,
              markerText: file.markerText,
            })),
          );
          await tx
            .update(schema.mergeRequests)
            .set({ status: "conflict", headCommit: currentHead, updatedAt: new Date() })
            .where(eq(schema.mergeRequests.id, mr.id));
        });

        reply.code(409);
        return {
          error: "Merge conflict",
          mrId: mr.id,
          conflictPaths: err.files.map((f) => f.path),
        };
      }
    },
  );

  server.post<{ Params: { bundleId: string; mrId: string } }>(
    "/bundles/:bundleId/merge-requests/:mrId/reject",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
      if (!mr) {
        return reply.code(404).send({ error: "Merge request not found" });
      }
      if (mr.status !== "open" && mr.status !== "conflict") {
        return reply.code(409).send({ error: `Merge request is '${mr.status}'` });
      }

      // Per PRD §7: rejected MRs return to draft on the same branch for rework, not closed permanently.
      await db.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, mr.id));
      const [updated] = await db
        .update(schema.mergeRequests)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(schema.mergeRequests.id, mr.id))
        .returning();

      return updated;
    },
  );

  // Manager-only: raw conflict markers for Prompt 9's resolution screen. Never exposed to authors.
  server.get<{ Params: { bundleId: string; mrId: string } }>(
    "/bundles/:bundleId/merge-requests/:mrId/conflicts",
    async (request, reply) => {
      const bundle = await getBundleOrNull(db, request.params.bundleId);
      if (!bundle) {
        return reply.code(404).send({ error: "Bundle not found" });
      }

      const allowed = await checkPermission(db, request.user, bundle, null, "review");
      if (!allowed) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const mr = isUuid(request.params.mrId)
        ? await db.query.mergeRequests.findFirst({
            where: and(
              eq(schema.mergeRequests.id, request.params.mrId),
              eq(schema.mergeRequests.bundleId, bundle.id),
            ),
            with: { author: { columns: { id: true, displayName: true, email: true } } },
          })
        : undefined;
      if (!mr) {
        return reply.code(404).send({ error: "Merge request not found" });
      }
      if (mr.status !== "conflict") {
        return reply.code(409).send({ error: `Merge request is '${mr.status}', not 'conflict'` });
      }

      const conflicts = await db.query.mrConflicts.findMany({
        where: eq(schema.mrConflicts.mrId, mr.id),
      });

      return { mr, conflicts };
    },
  );

  server.post<{
    Params: { bundleId: string; mrId: string };
    Body: { files: { path: string; content: string }[] };
  }>("/bundles/:bundleId/merge-requests/:mrId/resolve-conflict", async (request, reply) => {
    const bundle = await getBundleOrNull(db, request.params.bundleId);
    if (!bundle) {
      return reply.code(404).send({ error: "Bundle not found" });
    }

    const allowed = await checkPermission(db, request.user, bundle, null, "review");
    if (!allowed) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const mr = await getMrOrNull(db, bundle.id, request.params.mrId);
    if (!mr) {
      return reply.code(404).send({ error: "Merge request not found" });
    }
    if (mr.status !== "conflict") {
      return reply.code(409).send({ error: `Merge request is '${mr.status}', not 'conflict'` });
    }

    const files = request.body?.files;
    if (
      !Array.isArray(files) ||
      files.some((f) => typeof f?.path !== "string" || typeof f?.content !== "string")
    ) {
      return reply.code(400).send({ error: "files must be an array of { path, content }" });
    }

    const conflicts = await db.query.mrConflicts.findMany({
      where: eq(schema.mrConflicts.mrId, mr.id),
    });
    const expectedPaths = new Set(conflicts.map((c) => c.path));
    const submittedPaths = new Set(files.map((f) => f.path));
    const missing = [...expectedPaths].filter((p) => !submittedPaths.has(p));
    if (missing.length > 0) {
      return reply.code(400).send({ error: `Missing resolution for: ${missing.join(", ")}` });
    }

    const currentHead = await git.getRefOid(mr.branchName);
    if (!currentHead) {
      return reply.code(409).send({ error: "Author branch no longer exists" });
    }

    const beforeOid = await git.getRefOid(bundle.defaultBranch);
    try {
      const result = await git.resolveMergeConflict(
        mr.branchName,
        bundle.defaultBranch,
        `Merge request ${mr.id} (conflict resolved)`,
        files,
        mrPathPrefix(bundle, mr),
      );
      if (beforeOid) {
        await syncSearchIndex(db, git, bundle, mr, beforeOid, result.oid);
      }

      await db.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, mr.id));
      const [updated] = await db
        .update(schema.mergeRequests)
        .set({ status: "merged", headCommit: currentHead, updatedAt: new Date() })
        .where(eq(schema.mergeRequests.id, mr.id))
        .returning();

      return updated;
    } catch (err) {
      if (!(err instanceof MergeConflictDetectedError)) throw err;

      await db.transaction(async (tx) => {
        await tx.delete(schema.mrConflicts).where(eq(schema.mrConflicts.mrId, mr.id));
        await tx.insert(schema.mrConflicts).values(
          err.files.map((file) => ({
            mrId: mr.id,
            path: file.path,
            markerText: file.markerText,
          })),
        );
        await tx
          .update(schema.mergeRequests)
          .set({ status: "conflict", headCommit: currentHead, updatedAt: new Date() })
          .where(eq(schema.mergeRequests.id, mr.id));
      });

      reply.code(409);
      return {
        error: "Merge conflict",
        mrId: mr.id,
        conflictPaths: err.files.map((f) => f.path),
      };
    }
  });
}
