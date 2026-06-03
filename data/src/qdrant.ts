import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

export const llmClient = new OpenAI({
  baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4000/v1',
  apiKey:  process.env.LITELLM_API_KEY  ?? 'sk-litellm-master',
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const isGemini = model.includes('gemini');

  const createParams: any = {
    model,
    input: text,
  };

  // Gemini models have fixed dimensions; only set for other providers
  if (!isGemini) {
    createParams.dimensions = process.env.EMBEDDING_MODEL_DIMENSIONS 
      ? parseInt(process.env.EMBEDDING_MODEL_DIMENSIONS) 
      : 1536;
  }

  const response = await llmClient.embeddings.create(createParams);
  return response.data[0].embedding;
}

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});