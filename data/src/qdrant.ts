import { QdrantClient } from '@qdrant/js-client-rest';
import { llmClient } from '../../ai/src/llm/client';

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';

  // Only pass dimensions for models that support it (OpenAI text-embedding-3-*).
  // Gemini and local models (nomic, etc.) use fixed dimensions.
  const supportsCustomDimensions = model.startsWith('text-embedding-3');
  const createParams: { model: string; input: string; dimensions?: number } = { model, input: text };
  if (supportsCustomDimensions) {
    createParams.dimensions = Number(process.env.EMBEDDING_MODEL_DIMENSIONS ?? '1536') || 1536;
  }

  const response = await llmClient.embeddings.create(createParams);
  return response.data[0].embedding;
}

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});