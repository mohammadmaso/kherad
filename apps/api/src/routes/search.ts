import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, desc, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** How many rank-ordered rows to pull from Postgres before the per-page `checkPermission` gate narrows them to `limit`. */
const CANDIDATE_POOL_MULTIPLIER = 4;

export type SearchResult = {
  pageId: string;
  bundleId: string;
  bundleSlug: string;
  bundleTitle: string;
  path: string;
  title: string;
  rank: number;
  /** "raw": author source page (`/sources/...`). "okf": compiled knowledge-base doc (`/wiki/...`). */
  source: "raw" | "okf";
};

export async function searchRoutes(server: FastifyInstance, db: Database) {
  server.get<{ Querystring: { q?: string; limit?: string } }>("/search", async (request) => {
    const q = request.query.q?.trim();
    if (!q) {
      return { results: [] as SearchResult[] };
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const user = request.user;
    const isAdmin = user?.isAdmin ?? false;

    const tsQuery = sql`websearch_to_tsquery('english', ${q})`;
    const rank = sql<number>`ts_rank(${schema.searchIndex.tsv}, ${tsQuery})`;

    // Cheap SQL-level narrowing: public bundles, or bundles where the user
    // holds *some* permission grant. The exact per-path/per-action decision
    // still goes through `checkPermission` below — a grant on this bundle
    // doesn't necessarily cover this specific page's path.
    let visibility: SQL | undefined;
    if (!isAdmin) {
      visibility = user
        ? or(
            eq(schema.bundles.isPublic, true),
            exists(
              db
                .select({ one: sql`1` })
                .from(schema.permissions)
                .where(
                  and(
                    eq(schema.permissions.bundleId, schema.bundles.id),
                    eq(schema.permissions.userId, user.id),
                  ),
                ),
            ),
          )
        : eq(schema.bundles.isPublic, true);
    }

    const conditions = [
      sql`${schema.searchIndex.tsv} @@ ${tsQuery}`,
      eq(schema.pages.isDeleted, false),
      isNull(schema.bundles.archivedAt),
    ];
    if (visibility) conditions.push(visibility);

    const candidates = await db
      .select({
        pageId: schema.pages.id,
        path: schema.pages.path,
        title: schema.pages.title,
        source: schema.pages.source,
        bundleId: schema.bundles.id,
        bundleSlug: schema.bundles.slug,
        bundleTitle: schema.bundles.title,
        bundleIsPublic: schema.bundles.isPublic,
        rank,
      })
      .from(schema.searchIndex)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.searchIndex.pageId))
      .innerJoin(schema.bundles, eq(schema.bundles.id, schema.pages.bundleId))
      .where(and(...conditions))
      .orderBy(desc(rank))
      .limit(limit * CANDIDATE_POOL_MULTIPLIER);

    const results: SearchResult[] = [];
    for (const candidate of candidates) {
      if (results.length >= limit) break;

      // OKF docs have no page-level ACL story — resolveOkfWikiPage in
      // apps/web only ever checks bundle-level "view", never a doc path — so
      // mirror that here rather than gating on a path-prefix grant that was
      // never meant to cover compiled docs.
      const allowed =
        isAdmin ||
        (await checkPermission(
          db,
          user,
          { id: candidate.bundleId, isPublic: candidate.bundleIsPublic },
          candidate.source === "okf" ? null : candidate.path,
          "view",
        ));
      if (!allowed) continue;

      results.push({
        pageId: candidate.pageId,
        bundleId: candidate.bundleId,
        bundleSlug: candidate.bundleSlug,
        bundleTitle: candidate.bundleTitle,
        path: candidate.path,
        title: candidate.title,
        rank: candidate.rank,
        source: candidate.source,
      });
    }

    return { results };
  });
}
