import { QdrantClient } from '@qdrant/js-client-rest';
import { llmClient } from '../../ai/src/llm/client';

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const isGemini = model.includes('gemini');

  const createParams: {
    model: string;
    input: string;
    dimensions?: number;
  } = {
    model,
    input: text,
  };

  // Gemini models have fixed dimensions; only set for other providers
  if (!isGemini) {
    createParams.dimensions = Number(process.env.EMBEDDING_MODEL_DIMENSIONS ?? "1536") || 1536;
  }

  const response = await llmClient.embeddings.create(createParams);
  return response.data[0].embedding;
}

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});