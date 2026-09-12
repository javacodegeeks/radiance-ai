/**
 * Own Qdrant client + embedding generation — admin/server/ doesn't import
 * ai/src/llm/embeddings.ts or data/pipeline/05-vectorize.ts (package
 * independence, same as ai/ and data/ already don't import each other).
 * Same LiteLLM embeddings call shape as both of those.
 */
import { QdrantClient } from '@qdrant/js-client-rest';

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL!;
  const body: Record<string, unknown> = { model, input: text };

  const res = await fetch(`${process.env.LITELLM_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.LITELLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`[embeddings] model=${model} request failed: ${res.status} ${res.statusText}`);
    throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as EmbeddingResponse;
  const embedding = json.data[0].embedding;
  console.log(`[embeddings] model=${model} generated embedding dims=${embedding.length}`);
  return embedding;
}

console.log(`[qdrant] Client created url=${process.env.QDRANT_URL}`);
export const qdrant = new QdrantClient({ url: process.env.QDRANT_URL });
