import { QdrantClient } from '@qdrant/js-client-rest';

console.log(`[qdrant] Client created url=${process.env.QDRANT_URL}`);
export const qdrant = new QdrantClient({ url: process.env.QDRANT_URL });
