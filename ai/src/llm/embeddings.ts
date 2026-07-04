/**
 * Embedding generation — LLM concern, not an infra concern.
 * Kept separate from client.ts so it can be imported without pulling in
 * generation config or prompts.
 */

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL!;
  const dims  = process.env.EMBEDDING_MODEL_DIMENSIONS ? Number(process.env.EMBEDDING_MODEL_DIMENSIONS) : undefined;
  const body: Record<string, unknown> = { model, input: text };
  if (dims) body['dimensions'] = dims;

  const res = await fetch(`${process.env.LITELLM_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.LITELLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as EmbeddingResponse;
  return json.data[0].embedding;
}
