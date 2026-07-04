import { QdrantClient } from '@qdrant/js-client-rest';

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL!;
  const dims = process.env.EMBEDDING_MODEL_DIMENSIONS ? Number(process.env.EMBEDDING_MODEL_DIMENSIONS) : undefined;
  const body: Record<string, unknown> = { model, input: text };
  if (dims) body['dimensions'] = dims;

  const res = await fetch(`${process.env.LITELLM_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LITELLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
});
