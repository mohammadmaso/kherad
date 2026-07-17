import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, schema, type Database } from "@kherad/db";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGitEngine, type GitEngine } from "../git/engine";
import {
  deletePageEmbeddings,
  upsertPageEmbeddings,
  type Embedder,
} from "./embedding";
import { reconcileOkfSearchIndex, reconcileRawPagesFromGit } from "./refresh";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fakeEmbedder(dim = 4): Embedder {
  let call = 0;
  return {
    model: "test-embed",
    embed: async (texts) =>
      texts.map(() => {
        call += 1;
        return Array.from({ length: dim }, (_, i) => (call + i) * 0.01);
      }),
  };
}

describe("search embeddings + refresh", () => {
  let db: Database;
  let gitdir: string;
  let git: GitEngine;
  let bundle: typeof schema.bundles.$inferSelect;
  const author = { name: "Test", email: "test@kherad.local" };

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    db = createDb(connectionString);
  });

  beforeEach(async () => {
    gitdir = mkdtempSync(join(tmpdir(), "kherad-search-"));
    git = createGitEngine(gitdir);
    await git.initRepo();

    const suffix = randomSuffix();
    const [row] = await db
      .insert(schema.bundles)
      .values({ slug: `search-${suffix}`, title: "Search Test", isPublic: true })
      .returning();
    bundle = row!;
  });

  afterEach(async () => {
    if (bundle) {
      await db.delete(schema.bundles).where(eq(schema.bundles.id, bundle.id));
    }
    rmSync(gitdir, { recursive: true, force: true });
  });

  it("upserts and deletes embedding chunks", async () => {
    const [page] = await db
      .insert(schema.pages)
      .values({
        bundleId: bundle.id,
        source: "raw",
        path: "hello",
        title: "Hello",
      })
      .returning();

    const embedder = fakeEmbedder();
    await upsertPageEmbeddings(db, embedder, page!, "Hello", "# Hello\n\nWorld content here.");

    const chunks = await db.query.pageEmbeddingChunks.findMany({
      where: eq(schema.pageEmbeddingChunks.pageId, page!.id),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.model).toBe("test-embed");
    expect(chunks[0]!.dim).toBe(4);

    await deletePageEmbeddings(db, page!.id);
    const after = await db.query.pageEmbeddingChunks.findMany({
      where: eq(schema.pageEmbeddingChunks.pageId, page!.id),
    });
    expect(after).toHaveLength(0);
  });

  it("throwing embedder does not fail okf reconcile; metadata + Farsi tsv work", async () => {
    await git.writeAndCommit(
      "main",
      [
        {
          path: `okf/${bundle.slug}/concepts/payroll.md`,
          content: `---
type: concept
title: حقوق و دستمزد
tags:
  - finance
---

# حقوق و دستمزد

فرآیند پرداخت حقوق کارکنان.
`,
        },
      ],
      "add okf doc",
      author,
    );

    const throwing: Embedder = {
      model: "boom",
      embed: async () => {
        throw new Error("embedding down");
      },
    };

    await expect(reconcileOkfSearchIndex(db, git, bundle, throwing)).resolves.toBeUndefined();

    const pages = await db.query.pages.findMany({
      where: eq(schema.pages.bundleId, bundle.id),
    });
    expect(pages.length).toBeGreaterThan(0);

    const indexed = await db.query.searchIndex.findFirst({
      where: eq(schema.searchIndex.pageId, pages[0]!.id),
    });
    expect(indexed?.metadata).toMatchObject({ type: "concept", title: "حقوق و دستمزد" });
    expect(indexed?.content).toBeTruthy();

    const hit = await db.execute(sql`
      select 1 as ok
      from search_index
      where page_id = ${pages[0]!.id}::uuid
        and tsv @@ websearch_to_tsquery('simple', 'دستمزد')
    `);
    expect(Array.from(hit).length).toBeGreaterThan(0);
  });

  it("soft-deletes embeddings when raw page disappears from git", async () => {
    await git.writeAndCommit(
      "main",
      [
        {
          path: `raw/${bundle.slug}/gone.md`,
          content: "# Gone\n\nTemporary page.",
        },
      ],
      "add raw page",
      author,
    );

    const embedder = fakeEmbedder();
    await reconcileRawPagesFromGit(db, git, bundle, embedder);

    const pages = await db.query.pages.findMany({
      where: eq(schema.pages.bundleId, bundle.id),
    });
    expect(pages).toHaveLength(1);
    const pageId = pages[0]!.id;

    let chunks = await db.query.pageEmbeddingChunks.findMany({
      where: eq(schema.pageEmbeddingChunks.pageId, pageId),
    });
    expect(chunks.length).toBeGreaterThan(0);

    await git.writeAndCommit(
      "main",
      [{ path: `raw/${bundle.slug}/gone.md`, content: null }],
      "delete raw page",
      author,
    );

    await reconcileRawPagesFromGit(db, git, bundle, embedder);

    const stale = await db.query.pages.findFirst({ where: eq(schema.pages.id, pageId) });
    expect(stale?.isDeleted).toBe(true);

    chunks = await db.query.pageEmbeddingChunks.findMany({
      where: eq(schema.pageEmbeddingChunks.pageId, pageId),
    });
    expect(chunks).toHaveLength(0);

    const indexRow = await db.query.searchIndex.findFirst({
      where: eq(schema.searchIndex.pageId, pageId),
    });
    expect(indexRow).toBeUndefined();
  });
});
