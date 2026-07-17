import type { AuthedUser } from "@kherad/core/auth";
import { checkPermission } from "@kherad/core/permissions";
import { schema, type Database } from "@kherad/db";
import { and, desc, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { createEmbedder } from "../lib/embedder";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** How many rank-ordered rows to pull from Postgres before the per-page `checkPermission` gate narrows them to `limit`. */
const CANDIDATE_POOL_MULTIPLIER = 4;
const RRF_K = 60;
const SNIPPET_MAX = 300;

export type SearchMode = "keyword" | "semantic" | "hybrid";

export type SearchResult = {
  pageId: string;
  bundleId: string;
  bundleSlug: string;
  bundleTitle: string;
  path: string;
  title: string;
  /** Combined / primary score (RRF for hybrid, keyword rank, or semantic similarity). */
  rank: number;
  scores: {
    keyword: number | null;
    semantic: number | null;
    combined: number;
  };
  snippet: string | null;
  /** "raw": author source page (`/sources/...`). "okf": compiled knowledge-base doc (`/wiki/...`). */
  source: "raw" | "okf";
};

type Candidate = {
  pageId: string;
  path: string;
  title: string;
  source: "raw" | "okf";
  bundleId: string;
  bundleSlug: string;
  bundleTitle: string;
  bundleIsPublic: boolean;
  keywordRank: number | null;
  semanticSimilarity: number | null;
  snippet: string | null;
};

function parseMode(raw: string | undefined): SearchMode {
  if (raw === "semantic" || raw === "hybrid" || raw === "keyword") return raw;
  return "keyword";
}

function visibilityFilter(
  db: Database,
  user: AuthedUser | null | undefined,
  isAdmin: boolean,
): SQL | undefined {
  if (isAdmin) return undefined;
  return user
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

function vectorSql(vec: number[]): ReturnType<typeof sql> {
  // Numbers only — safe to inline as a pgvector literal.
  return sql.raw(`'[${vec.map((n) => Number(n)).join(",")}]'::vector`);
}

async function keywordSearch(
  db: Database,
  q: string,
  pool: number,
  visibility: SQL | undefined,
): Promise<Candidate[]> {
  const englishQ = sql`websearch_to_tsquery('english', ${q})`;
  const simpleQ = sql`websearch_to_tsquery('simple', ${q})`;
  const tsQuery = sql`${englishQ} || ${simpleQ}`;
  const rank = sql<number>`ts_rank(${schema.searchIndex.tsv}, ${tsQuery})`;
  const snippet = sql<string | null>`ts_headline(
    'english',
    coalesce(${schema.searchIndex.content}, ''),
    ${tsQuery},
    'StartSel=⟪, StopSel=⟫, MaxWords=18, MinWords=8'
  )`;

  const conditions: SQL[] = [
    or(
      sql`${schema.searchIndex.tsv} @@ ${englishQ}`,
      sql`${schema.searchIndex.tsv} @@ ${simpleQ}`,
    )!,
    eq(schema.pages.isDeleted, false),
    isNull(schema.bundles.archivedAt),
  ];
  if (visibility) conditions.push(visibility);

  const rows = await db
    .select({
      pageId: schema.pages.id,
      path: schema.pages.path,
      title: schema.pages.title,
      source: schema.pages.source,
      bundleId: schema.bundles.id,
      bundleSlug: schema.bundles.slug,
      bundleTitle: schema.bundles.title,
      bundleIsPublic: schema.bundles.isPublic,
      keywordRank: rank,
      snippet,
    })
    .from(schema.searchIndex)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.searchIndex.pageId))
    .innerJoin(schema.bundles, eq(schema.bundles.id, schema.pages.bundleId))
    .where(and(...conditions))
    .orderBy(desc(rank))
    .limit(pool);

  return rows.map((row) => ({
    pageId: row.pageId,
    path: row.path,
    title: row.title,
    source: row.source,
    bundleId: row.bundleId,
    bundleSlug: row.bundleSlug,
    bundleTitle: row.bundleTitle,
    bundleIsPublic: row.bundleIsPublic,
    keywordRank: row.keywordRank,
    semanticSimilarity: null,
    snippet: row.snippet,
  }));
}

async function semanticSearch(
  db: Database,
  queryVec: number[],
  model: string,
  pool: number,
  visibility: SQL | undefined,
): Promise<Candidate[]> {
  const qvec = vectorSql(queryVec);
  const similarity = sql<number>`max(1 - (${schema.pageEmbeddingChunks.embedding} <=> ${qvec}))`;
  const snippet = sql<string | null>`left(
    (array_agg(${schema.pageEmbeddingChunks.content} ORDER BY ${schema.pageEmbeddingChunks.embedding} <=> ${qvec}))[1],
    ${SNIPPET_MAX}
  )`;

  const conditions: SQL[] = [
    eq(schema.pageEmbeddingChunks.model, model),
    eq(schema.pages.isDeleted, false),
    isNull(schema.bundles.archivedAt),
  ];
  if (visibility) conditions.push(visibility);

  const rows = await db
    .select({
      pageId: schema.pages.id,
      path: schema.pages.path,
      title: schema.pages.title,
      source: schema.pages.source,
      bundleId: schema.bundles.id,
      bundleSlug: schema.bundles.slug,
      bundleTitle: schema.bundles.title,
      bundleIsPublic: schema.bundles.isPublic,
      similarity,
      snippet,
    })
    .from(schema.pageEmbeddingChunks)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.pageEmbeddingChunks.pageId))
    .innerJoin(schema.bundles, eq(schema.bundles.id, schema.pages.bundleId))
    .where(and(...conditions))
    .groupBy(
      schema.pages.id,
      schema.pages.path,
      schema.pages.title,
      schema.pages.source,
      schema.bundles.id,
      schema.bundles.slug,
      schema.bundles.title,
      schema.bundles.isPublic,
    )
    .orderBy(desc(similarity))
    .limit(pool);

  return rows.map((row) => ({
    pageId: row.pageId,
    path: row.path,
    title: row.title,
    source: row.source,
    bundleId: row.bundleId,
    bundleSlug: row.bundleSlug,
    bundleTitle: row.bundleTitle,
    bundleIsPublic: row.bundleIsPublic,
    keywordRank: null,
    semanticSimilarity: row.similarity,
    snippet: row.snippet,
  }));
}

/** Reciprocal Rank Fusion over keyword + semantic candidate pools (k=60). */
function fuseRrf(
  keyword: Candidate[],
  semantic: Candidate[],
): Array<Candidate & { combined: number }> {
  const byId = new Map<string, Candidate & { combined: number }>();

  const add = (list: Candidate[], branch: "keyword" | "semantic") => {
    list.forEach((c, i) => {
      const contribution = 1 / (RRF_K + i + 1);
      const existing = byId.get(c.pageId);
      if (existing) {
        existing.combined += contribution;
        if (branch === "keyword") {
          existing.keywordRank = c.keywordRank;
          if (!existing.snippet && c.snippet) existing.snippet = c.snippet;
        } else {
          existing.semanticSimilarity = c.semanticSimilarity;
          if (c.snippet) existing.snippet = c.snippet;
        }
      } else {
        byId.set(c.pageId, { ...c, combined: contribution });
      }
    });
  };

  add(keyword, "keyword");
  add(semantic, "semantic");

  return [...byId.values()].sort((a, b) => b.combined - a.combined);
}

async function gateResults(
  db: Database,
  user: AuthedUser | null,
  isAdmin: boolean,
  candidates: Array<Candidate & { combined: number }>,
  limit: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const candidate of candidates) {
    if (results.length >= limit) break;

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
      rank: candidate.combined,
      scores: {
        keyword: candidate.keywordRank,
        semantic: candidate.semanticSimilarity,
        combined: candidate.combined,
      },
      snippet: candidate.snippet,
      source: candidate.source,
    });
  }
  return results;
}

export async function searchRoutes(server: FastifyInstance, db: Database) {
  server.get<{
    Querystring: { q?: string; limit?: string; mode?: string };
  }>("/search", async (request) => {
    const q = request.query.q?.trim();
    const requestedMode = parseMode(request.query.mode);
    const embedder = await createEmbedder(db);
    const semanticAvailable = embedder !== null;

    if (!q) {
      return {
        results: [] as SearchResult[],
        mode: requestedMode,
        semanticAvailable,
      };
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const user = request.user;
    const isAdmin = user?.isAdmin ?? false;
    const visibility = visibilityFilter(db, user, isAdmin);
    const pool = limit * CANDIDATE_POOL_MULTIPLIER;

    let mode: SearchMode = requestedMode;
    if (mode === "semantic" && !embedder) {
      return { results: [] as SearchResult[], mode, semanticAvailable: false };
    }
    if (mode === "hybrid" && !embedder) {
      mode = "keyword";
    }

    let candidates: Array<Candidate & { combined: number }> = [];

    if (mode === "keyword") {
      const rows = await keywordSearch(db, q, pool, visibility);
      candidates = rows.map((r) => ({
        ...r,
        combined: r.keywordRank ?? 0,
      }));
    } else if (mode === "semantic" && embedder) {
      const [queryVec] = await embedder.embed([q]);
      if (!queryVec) {
        return { results: [] as SearchResult[], mode, semanticAvailable };
      }
      const rows = await semanticSearch(db, queryVec, embedder.model, pool, visibility);
      candidates = rows.map((r) => ({
        ...r,
        combined: r.semanticSimilarity ?? 0,
      }));
    } else if (mode === "hybrid" && embedder) {
      const [queryVec] = await embedder.embed([q]);
      const [kw, sem] = await Promise.all([
        keywordSearch(db, q, pool, visibility),
        queryVec
          ? semanticSearch(db, queryVec, embedder.model, pool, visibility)
          : Promise.resolve([] as Candidate[]),
      ]);
      candidates = fuseRrf(kw, sem);
    }

    const results = await gateResults(db, user ?? null, isAdmin, candidates, limit);
    return { results, mode, semanticAvailable };
  });
}
