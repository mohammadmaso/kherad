import type { AuthedUser } from "@kherad/core/auth";
import { checkPermission } from "@kherad/core/permissions";
import type { Embedder } from "@kherad/core/search";
import { schema, type Database } from "@kherad/db";
import { createTool } from "@mastra/core/tools";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

type BundleScope = {
  kind: "bundle";
  bundle: { id: string; slug: string; isPublic: boolean };
  /** When set, restrict to that page source (chat uses "okf"). */
  source?: "okf" | "raw";
};

type UserScope = {
  kind: "user";
  user: AuthedUser;
};

type SearchScope = BundleScope | UserScope;

function vectorSql(vec: number[]) {
  return sql.raw(`'[${vec.map((n) => Number(n)).join(",")}]'::vector`);
}

function buildMetadataFilter(args: {
  type?: string;
  tags?: string[];
  resource?: string;
}): SQL | undefined {
  const parts: Record<string, unknown> = {};
  if (args.type) parts.type = args.type;
  if (args.resource) parts.resource = args.resource;
  if (args.tags?.length) parts.tags = args.tags;
  if (Object.keys(parts).length === 0) return undefined;
  // jsonb containment: metadata @> '{"type":"concept","tags":["payroll"]}'
  return sql`${schema.searchIndex.metadata} @> ${JSON.stringify(parts)}::jsonb`;
}

/**
 * Shared semantic_search + find_docs_by_metadata tools for chat, specialist,
 * and interviewer agents.
 */
export function createSearchTools(args: {
  db: Database;
  embedderFactory: () => Promise<Embedder | null>;
  scope: SearchScope;
}) {
  const { db, embedderFactory, scope } = args;

  async function allowResult(row: {
    bundleId: string;
    bundleIsPublic: boolean;
    path: string;
    source: "raw" | "okf";
  }): Promise<boolean> {
    if (scope.kind === "bundle") {
      if (row.bundleId !== scope.bundle.id) return false;
      if (scope.source && row.source !== scope.source) return false;
      return true;
    }
    return checkPermission(
      db,
      scope.user,
      { id: row.bundleId, isPublic: row.bundleIsPublic },
      row.source === "okf" ? null : row.path,
      "view",
    );
  }

  function scopeConditions(): SQL[] {
    const conditions: SQL[] = [
      eq(schema.pages.isDeleted, false),
      isNull(schema.bundles.archivedAt),
    ];
    if (scope.kind === "bundle") {
      conditions.push(eq(schema.pages.bundleId, scope.bundle.id));
      if (scope.source) conditions.push(eq(schema.pages.source, scope.source));
    }
    return conditions;
  }

  const semanticSearch = createTool({
    id: "semantic_search",
    description:
      "Semantic (meaning-based) search over wiki documents. Prefer this when the user paraphrases or asks conceptually rather than naming an exact title. Optionally filter by bundle slug, document type, or tags from frontmatter.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Natural-language search query"),
      bundleSlug: z.string().optional().describe("Limit to one bundle slug"),
      type: z.string().optional().describe("Frontmatter type filter (e.g. concept)"),
      tags: z.array(z.string()).optional().describe("Require these frontmatter tags"),
      limit: z.number().int().min(1).max(15).optional().describe("Max results (default 8)"),
    }),
    execute: async ({ query, bundleSlug, type, tags, limit: rawLimit }) => {
      const embedder = await embedderFactory();
      if (!embedder) {
        return { error: "Semantic search is not configured by the admin" };
      }

      const limit = rawLimit ?? 8;
      const [queryVec] = await embedder.embed([query]);
      if (!queryVec) return { results: [] };

      const qvec = vectorSql(queryVec);
      const similarity = sql<number>`max(1 - (${schema.pageEmbeddingChunks.embedding} <=> ${qvec}))`;
      const snippet = sql<string | null>`left(
        (array_agg(${schema.pageEmbeddingChunks.content} ORDER BY ${schema.pageEmbeddingChunks.embedding} <=> ${qvec}))[1],
        300
      )`;

      const conditions = [
        ...scopeConditions(),
        eq(schema.pageEmbeddingChunks.model, embedder.model),
      ];
      if (bundleSlug) conditions.push(eq(schema.bundles.slug, bundleSlug));
      const metaFilter = buildMetadataFilter({ type, tags });
      if (metaFilter) conditions.push(metaFilter);

      const rows = await db
        .select({
          pageId: schema.pages.id,
          path: schema.pages.path,
          title: schema.pages.title,
          source: schema.pages.source,
          bundleId: schema.bundles.id,
          bundleSlug: schema.bundles.slug,
          bundleIsPublic: schema.bundles.isPublic,
          similarity,
          snippet,
          metadata: schema.searchIndex.metadata,
        })
        .from(schema.pageEmbeddingChunks)
        .innerJoin(schema.pages, eq(schema.pages.id, schema.pageEmbeddingChunks.pageId))
        .innerJoin(schema.bundles, eq(schema.bundles.id, schema.pages.bundleId))
        .leftJoin(schema.searchIndex, eq(schema.searchIndex.pageId, schema.pages.id))
        .where(and(...conditions))
        .groupBy(
          schema.pages.id,
          schema.pages.path,
          schema.pages.title,
          schema.pages.source,
          schema.bundles.id,
          schema.bundles.slug,
          schema.bundles.isPublic,
          schema.searchIndex.metadata,
        )
        .orderBy(desc(similarity))
        .limit(limit * 4);

      const results: Array<{
        bundleSlug: string;
        path: string;
        title: string;
        source: "raw" | "okf";
        similarity: number;
        snippet: string | null;
        metadata: unknown;
      }> = [];

      for (const row of rows) {
        if (results.length >= limit) break;
        if (!(await allowResult(row))) continue;
        results.push({
          bundleSlug: row.bundleSlug,
          path: row.path,
          title: row.title,
          source: row.source,
          similarity: row.similarity,
          snippet: row.snippet,
          metadata: row.metadata,
        });
      }

      return { results };
    },
  });

  const findDocsByMetadata = createTool({
    id: "find_docs_by_metadata",
    description:
      "Find documents by frontmatter metadata (type, tags, resource). Does not require embeddings. At least one filter is required.",
    inputSchema: z.object({
      bundleSlug: z.string().optional(),
      type: z.string().optional(),
      tags: z.array(z.string()).optional(),
      resource: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ bundleSlug, type, tags, resource, limit: rawLimit }) => {
      if (!bundleSlug && !type && !(tags && tags.length > 0) && !resource) {
        return { error: "Provide at least one filter: bundleSlug, type, tags, or resource" };
      }

      const limit = rawLimit ?? 20;
      const conditions = [...scopeConditions()];
      if (bundleSlug) conditions.push(eq(schema.bundles.slug, bundleSlug));
      const metaFilter = buildMetadataFilter({ type, tags, resource });
      if (metaFilter) conditions.push(metaFilter);
      // When only bundleSlug is set, still require non-null metadata so we
      // don't dump every raw page without frontmatter.
      if (!metaFilter) {
        conditions.push(sql`${schema.searchIndex.metadata} is not null`);
      }

      const rows = await db
        .select({
          pageId: schema.pages.id,
          path: schema.pages.path,
          title: schema.pages.title,
          source: schema.pages.source,
          bundleId: schema.bundles.id,
          bundleSlug: schema.bundles.slug,
          bundleIsPublic: schema.bundles.isPublic,
          metadata: schema.searchIndex.metadata,
        })
        .from(schema.searchIndex)
        .innerJoin(schema.pages, eq(schema.pages.id, schema.searchIndex.pageId))
        .innerJoin(schema.bundles, eq(schema.bundles.id, schema.pages.bundleId))
        .where(and(...conditions))
        .orderBy(schema.pages.title)
        .limit(limit * 4);

      const results: Array<{
        bundleSlug: string;
        path: string;
        title: string;
        source: "raw" | "okf";
        metadata: unknown;
      }> = [];

      for (const row of rows) {
        if (results.length >= limit) break;
        if (!(await allowResult(row))) continue;
        results.push({
          bundleSlug: row.bundleSlug,
          path: row.path,
          title: row.title,
          source: row.source,
          metadata: row.metadata,
        });
      }

      return { results };
    },
  });

  return {
    semantic_search: semanticSearch,
    find_docs_by_metadata: findDocsByMetadata,
  };
}
