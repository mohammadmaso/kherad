import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Embedder } from "@kherad/core/search";
import type { Database } from "@kherad/db";
import { embedMany } from "ai";

import { loadEmbeddingSettings } from "../agents/embedding-settings";

const BATCH_SIZE = 64;

/**
 * Builds an Embedder from admin embedding settings, or null when unconfigured.
 * Batches embed() calls in groups of 64.
 */
export async function createEmbedder(db: Database): Promise<Embedder | null> {
  const settings = await loadEmbeddingSettings(db);
  if (!settings) return null;

  const provider = createOpenAICompatible({
    name: "embeddings",
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
  });
  const model = provider.textEmbeddingModel(settings.model);

  return {
    model: settings.model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const { embeddings } = await embedMany({ model, values: batch });
        out.push(...embeddings);
      }
      return out;
    },
  };
}
