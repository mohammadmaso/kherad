import { schema, type Database } from "@kherad/db";
import { eq } from "drizzle-orm";

import { chunkMarkdownForEmbedding } from "./chunking";

export type Embedder = {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
};

/**
 * Replace all embedding chunks for a page. Throws on embed failure —
 * callers (refresh pipeline) wrap so merges never break.
 */
export async function upsertPageEmbeddings(
  db: Database,
  embedder: Embedder,
  page: { id: string },
  title: string,
  markdown: string,
): Promise<void> {
  const chunks = await chunkMarkdownForEmbedding(title, markdown);
  if (chunks.length === 0) {
    await deletePageEmbeddings(db, page.id);
    return;
  }

  const vectors = await embedder.embed(chunks);
  if (vectors.length !== chunks.length) {
    throw new Error(
      `Embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
    );
  }

  await db
    .delete(schema.pageEmbeddingChunks)
    .where(eq(schema.pageEmbeddingChunks.pageId, page.id));

  const now = new Date();
  await db.insert(schema.pageEmbeddingChunks).values(
    chunks.map((content, chunkIndex) => {
      const embedding = vectors[chunkIndex]!;
      return {
        pageId: page.id,
        chunkIndex,
        content,
        embedding,
        model: embedder.model,
        dim: embedding.length,
        updatedAt: now,
      };
    }),
  );
}

export async function deletePageEmbeddings(db: Database, pageId: string): Promise<void> {
  await db
    .delete(schema.pageEmbeddingChunks)
    .where(eq(schema.pageEmbeddingChunks.pageId, pageId));
}
