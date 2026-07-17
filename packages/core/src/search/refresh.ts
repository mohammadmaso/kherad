import { schema, type Database } from "@kherad/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { GitEngine } from "../git/engine";
import {
  bundleGitPathPrefix,
  isImageAssetPath,
  legacyBundleGitPathPrefix,
  okfDocSitePath,
  okfGitPathPrefix,
} from "../git/paths";
import {
  frontmatterToMetadata,
  parseOkfFrontmatter,
  stripFrontmatter,
} from "../markdown/frontmatter";
import { renderMarkdownToText } from "../markdown/to-text";
import { deletePageEmbeddings, upsertPageEmbeddings, type Embedder } from "./embedding";

type BundleRef = { id: string; slug: string; defaultBranch: string };

const CONTENT_CAP = 50_000;

/** Strips a diff entry's git path down to the raw page's own `path` column. */
function pageSourcePath(bundleSlug: string, gitPath: string): string | null {
  for (const root of [`raw/${bundleSlug}/`, `wiki/${bundleSlug}/`]) {
    if (gitPath.startsWith(root) && gitPath.endsWith(".md")) {
      return gitPath.slice(root.length, -".md".length);
    }
  }
  return null;
}

async function indexPage(
  db: Database,
  page: { id: string; title: string },
  markdown: string,
  metadata: Record<string, unknown> | null,
  embedder?: Embedder | null,
): Promise<void> {
  const text = await renderMarkdownToText(markdown);
  // Postgres text / to_tsvector reject NUL bytes; strip defensively in case a
  // bad blob was committed under a .md path.
  const indexed = `${page.title}\n${text}`.replaceAll("\0", "");
  const content = indexed.slice(0, CONTENT_CAP);

  // english (stemmed) || simple (exact tokens) so Farsi and other non-English
  // tokens match without relying on the english stemmer alone.
  await db
    .insert(schema.searchIndex)
    .values({
      pageId: page.id,
      tsv: sql`to_tsvector('english', ${indexed}) || to_tsvector('simple', ${indexed})`,
      content,
      metadata,
    })
    .onConflictDoUpdate({
      target: schema.searchIndex.pageId,
      set: {
        tsv: sql`to_tsvector('english', ${indexed}) || to_tsvector('simple', ${indexed})`,
        content,
        metadata,
      },
    });

  if (embedder) {
    try {
      await upsertPageEmbeddings(db, embedder, page, page.title, markdown);
    } catch (err) {
      console.error(`[search] embedding failed for page ${page.id}:`, err);
    }
  }
}

/**
 * Re-derives the `search_index` tsvector for *raw* (author-edited) pages
 * touched by a merge into a bundle's default branch. Called after every
 * successful `squashMerge` / `resolveMergeConflict` on a `"wiki"`-scope MR —
 * diffs the pre/post merge commits scoped to this bundle's source path
 * (rather than re-indexing the whole bundle on every merge) and drops the
 * index row for any page the merge deleted. OKF docs are handled separately
 * by `reconcileOkfSearchIndex`, since they have no pre-existing `pages` row
 * to diff against.
 */
export async function refreshSearchIndexForMerge(
  db: Database,
  git: GitEngine,
  bundle: BundleRef,
  beforeOid: string,
  afterOid: string,
  embedder?: Embedder | null,
): Promise<void> {
  if (beforeOid === afterOid) return;

  // New writes land under raw/; also scan legacy wiki/ so older merges still index.
  const [rawDiff, legacyDiff] = await Promise.all([
    git.diffRefs(beforeOid, afterOid, bundleGitPathPrefix(bundle.slug)),
    git.diffRefs(beforeOid, afterOid, legacyBundleGitPathPrefix(bundle.slug)),
  ]);
  const byPath = new Map<string, (typeof rawDiff)[number]>();
  for (const entry of [...legacyDiff, ...rawDiff]) byPath.set(entry.path, entry);

  const touched = [...byPath.values()]
    .filter((entry) => !isImageAssetPath(entry.path))
    .map((entry) => ({
      status: entry.status,
      gitPath: entry.path,
      pagePath: pageSourcePath(bundle.slug, entry.path),
    }))
    .filter((entry): entry is typeof entry & { pagePath: string } => entry.pagePath !== null);

  if (touched.length === 0) return;

  const pages = await db.query.pages.findMany({
    where: and(
      eq(schema.pages.bundleId, bundle.id),
      eq(schema.pages.source, "raw"),
      inArray(
        schema.pages.path,
        touched.map((entry) => entry.pagePath),
      ),
    ),
  });
  const pageByPath = new Map(pages.map((page) => [page.path, page]));

  for (const entry of touched) {
    const page = pageByPath.get(entry.pagePath);
    if (!page) continue;

    if (entry.status === "deleted" || page.isDeleted) {
      await db.delete(schema.searchIndex).where(eq(schema.searchIndex.pageId, page.id));
      await deletePageEmbeddings(db, page.id);
      continue;
    }

    const contentBytes = await git.getFileAtRef(afterOid, entry.gitPath);
    if (contentBytes === null) continue;

    const markdown = new TextDecoder().decode(contentBytes);
    await indexPage(db, page, markdown, null, embedder);
  }
}

/** First ATX heading in the markdown, for titling pages that arrive from a remote pull. */
function titleFromMarkdownHeading(markdown: string): string | null {
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

function titleFromPagePath(pagePath: string): string {
  const base = pagePath.split("/").pop() ?? pagePath;
  return base.replace(/[-_]+/g, " ").trim() || base;
}

/**
 * Fully reconciles raw `pages`/`search_index` rows against the bundle's
 * current source tree (`raw/<slug>/**.md` at `defaultBranch`). Called after a
 * bundle is pulled from its git remote, where files can appear/change/vanish
 * without going through the page CRUD routes that normally maintain the rows.
 *
 * Existing rows keep their curated titles; new files get a title from their
 * first markdown heading, falling back to the filename. Page paths are taken
 * verbatim from the git tree (they are the join key back into it). Rows whose
 * file disappeared are soft-deleted, mirroring the page-delete route. Legacy
 * `wiki/<slug>` files count as live too (with `raw/` winning per path), so
 * restoring a pre-migration snapshot doesn't soft-delete every page.
 */
export async function reconcileRawPagesFromGit(
  db: Database,
  git: GitEngine,
  bundle: BundleRef,
  embedder?: Embedder | null,
): Promise<{ upserted: number; deleted: number }> {
  const commitOid = await git.getRefOid(bundle.defaultBranch);
  if (!commitOid) return { upserted: 0, deleted: 0 };

  const byPagePath = new Map<string, string>();
  for (const prefix of [legacyBundleGitPathPrefix(bundle.slug), bundleGitPathPrefix(bundle.slug)]) {
    for (const gitPath of await git.listFilesAtRef(bundle.defaultBranch, prefix)) {
      if (!gitPath.endsWith(".md") || isImageAssetPath(gitPath)) continue;
      byPagePath.set(gitPath.slice(prefix.length + 1, -".md".length), gitPath);
    }
  }
  const files = [...byPagePath.entries()].map(([pagePath, gitPath]) => ({ gitPath, pagePath }));

  const existingRows = await db.query.pages.findMany({
    where: and(eq(schema.pages.bundleId, bundle.id), eq(schema.pages.source, "raw")),
  });
  const existingByPath = new Map(existingRows.map((row) => [row.path, row]));

  const livePaths: string[] = [];
  let upserted = 0;
  for (const { gitPath, pagePath } of files) {
    const contentBytes = await git.getFileAtRef(commitOid, gitPath);
    if (contentBytes === null) continue;

    const markdown = new TextDecoder().decode(contentBytes);
    const title =
      existingByPath.get(pagePath)?.title ??
      titleFromMarkdownHeading(markdown) ??
      titleFromPagePath(pagePath);

    const [page] = await db
      .insert(schema.pages)
      .values({ bundleId: bundle.id, source: "raw", path: pagePath, title })
      .onConflictDoUpdate({
        target: [schema.pages.bundleId, schema.pages.source, schema.pages.path],
        // Title is intentionally not overwritten — it's curated in Postgres.
        set: { isDeleted: false, redirectTo: null },
      })
      .returning();
    if (!page) continue;

    livePaths.push(pagePath);
    upserted += 1;
    await indexPage(db, page, markdown, null, embedder);
  }

  // Soft-delete rows whose file no longer exists after the pull.
  const liveSet = new Set(livePaths);
  const stale = existingRows.filter((row) => !row.isDeleted && !liveSet.has(row.path));
  for (const row of stale) {
    await db
      .update(schema.pages)
      .set({ isDeleted: true })
      .where(eq(schema.pages.id, row.id));
    await db.delete(schema.searchIndex).where(eq(schema.searchIndex.pageId, row.id));
    await deletePageEmbeddings(db, row.id);
  }

  return { upserted, deleted: stale.length };
}

/**
 * Fully reconciles `pages`/`search_index` rows (`source: "okf"`) against the
 * bundle's *current* compiled tree (`okf/<slug>/**.md` at `defaultBranch`).
 * Called after every OKF-scope merge (indexer-agent compiles happen rarely —
 * unlike raw page saves — so walking the whole subtree each time is cheap
 * and, unlike a beforeOid/afterOid diff, also self-heals any doc that was
 * already on `main` before this reconcile existed (e.g. from a compile that
 * merged before this codepath was added). Every doc under the prefix is
 * indexed, including `index.md` and `log.md` — there's no separate handling
 * for reserved filenames. `source/**` mirrors of raw pages are included too:
 * they're read-only public copies of author content and should be just as
 * searchable as the compiled concept docs.
 */
export async function reconcileOkfSearchIndex(
  db: Database,
  git: GitEngine,
  bundle: BundleRef,
  embedder?: Embedder | null,
): Promise<void> {
  const prefix = okfGitPathPrefix(bundle.slug);
  const commitOid = await git.getRefOid(bundle.defaultBranch);
  if (!commitOid) return;

  const docPaths = (await git.listFilesAtRef(bundle.defaultBranch, prefix))
    .filter((gitPath) => !isImageAssetPath(gitPath) && gitPath.endsWith(".md"))
    .map((gitPath) => ({ gitPath, sitePath: okfDocSitePath(gitPath.slice(prefix.length + 1)) }));

  const livePaths: string[] = [];
  for (const { gitPath, sitePath } of docPaths) {
    const contentBytes = await git.getFileAtRef(commitOid, gitPath);
    if (contentBytes === null) continue;

    const markdown = new TextDecoder().decode(contentBytes);
    const frontmatter = parseOkfFrontmatter(markdown);
    const fallbackTitle = sitePath.split("/").pop() ?? sitePath;
    const title = frontmatter?.title?.trim() || fallbackTitle;
    const body = stripFrontmatter(markdown);
    const metadata = frontmatterToMetadata(frontmatter);

    const [page] = await db
      .insert(schema.pages)
      .values({ bundleId: bundle.id, source: "okf", path: sitePath, title })
      .onConflictDoUpdate({
        target: [schema.pages.bundleId, schema.pages.source, schema.pages.path],
        set: { title, isDeleted: false, redirectTo: null },
      })
      .returning();
    if (!page) continue;

    livePaths.push(sitePath);
    await indexPage(db, page, body, metadata, embedder);
  }

  // Drop rows for docs no longer in the tree (deleted since the last reconcile).
  // Hard-delete cascades to search_index + page_embedding_chunks via FK.
  const staleFilter =
    livePaths.length > 0
      ? and(
          eq(schema.pages.bundleId, bundle.id),
          eq(schema.pages.source, "okf"),
          notInArray(schema.pages.path, livePaths),
        )
      : and(eq(schema.pages.bundleId, bundle.id), eq(schema.pages.source, "okf"));
  await db.delete(schema.pages).where(staleFilter);
}

/**
 * Full reconcile of raw + OKF search/embeddings for one bundle. Used by the
 * admin reindex action to backfill tsv/content/metadata/vectors.
 */
export async function reindexBundleSearch(
  db: Database,
  git: GitEngine,
  bundle: BundleRef,
  embedder?: Embedder | null,
): Promise<{ pages: number; embedFailures: number }> {
  // Count failures by wrapping embedder so indexPage's try/catch still logs,
  // but we also track how many pages failed embedding for the admin UI.
  let embedFailures = 0;
  const tracked: Embedder | null | undefined = embedder
    ? {
        model: embedder.model,
        embed: async (texts) => {
          try {
            return await embedder.embed(texts);
          } catch (err) {
            embedFailures += 1;
            throw err;
          }
        },
      }
    : embedder;

  await reconcileRawPagesFromGit(db, git, bundle, tracked);
  await reconcileOkfSearchIndex(db, git, bundle, tracked);

  const livePages = await db.query.pages.findMany({
    where: and(
      eq(schema.pages.bundleId, bundle.id),
      eq(schema.pages.isDeleted, false),
    ),
    columns: { id: true },
  });

  return { pages: livePages.length, embedFailures };
}
