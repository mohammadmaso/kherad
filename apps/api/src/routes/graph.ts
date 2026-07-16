import { userBranchName, type GitEngine } from "@kherad/core/git";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { getBundleOrNull } from "../lib/get-bundle";

export type GraphNode = { id: string; title: string; path: string };
export type GraphEdge = { from: string; to: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function graphRoutes(server: FastifyInstance, db: Database, git: GitEngine) {
  // The bundle's internal-link graph: one node per visible source page, one
  // edge per markdown link to another page in the same bundle. Links may be
  // `/wiki/…` (legacy), `/sources/…` (raw sources), or plain page paths.
  server.get<{ Params: { bundleId: string } }>(
    "/bundles/:bundleId/graph",
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
      const visibleFlags = await Promise.all(
        pages.map((page) => checkPermission(db, request.user, bundle, page.path, "view")),
      );
      const visible = pages.filter((_, i) => visibleFlags[i]);
      if (visible.length === 0) {
        return { nodes: [], edges: [] };
      }

      const userBranch = request.user ? userBranchName(request.user.id) : null;
      const branches = userBranch ? await git.listBranches() : [];
      const readRef =
        userBranch && branches.includes(userBranch) ? userBranch : bundle.defaultBranch;

      const idByPath = new Map(visible.map((page) => [page.path, page.id]));
      const slug = escapeRegExp(bundle.slug);
      const linkPattern = new RegExp(
        `\\]\\((?:/wiki/${slug}/|/sources/${slug}/)?([^)#?\\s]+)`,
        "g",
      );

      const edges: GraphEdge[] = [];
      const seen = new Set<string>();
      const decoder = new TextDecoder();

      await Promise.all(
        visible.map(async (page) => {
          const bytes = await git.getSourcePageAtRef(readRef, bundle.slug, page.path);
          if (!bytes) return;
          const content = decoder.decode(bytes);
          for (const match of content.matchAll(linkPattern)) {
            let target = match[1]!;
            try {
              target = decodeURIComponent(target);
            } catch {
              // keep the raw path if it isn't valid percent-encoding
            }
            const targetId = idByPath.get(target);
            if (!targetId || targetId === page.id) continue;
            const key = `${page.id}->${targetId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ from: page.id, to: targetId });
          }
        }),
      );

      const nodes: GraphNode[] = visible.map((page) => ({
        id: page.id,
        title: page.title,
        path: page.path,
      }));

      return { nodes, edges };
    },
  );
}
