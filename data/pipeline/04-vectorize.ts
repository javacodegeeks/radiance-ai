/**
 * Step 4 — Generate embeddings for all MongoDB products and upsert into Qdrant.
 *
 * Reads products from MongoDB, generates embeddings via LiteLLM, and bulk-upserts
 * into the Qdrant vector store. Auto-detects embedding dimensions and recreates
 * the collection if the model has changed.
 *
 * Usage:
 *   npm run pipeline:vectorize          # sync all
 *   npm run pipeline:vectorize -- 500   # sync first 500 (for testing)
 */
import { v5 as uuidv5 } from 'uuid';
import { Schemas } from '@qdrant/js-client-rest';
import { getDb, closeDb } from '../src/infra/mongo';
import { qdrant, generateEmbedding } from '../src/infra/qdrant';

const UUID_NAMESPACE  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const COLLECTION_NAME = 'products';
const BATCH_SIZE      = 100;
const CONCURRENCY     = 5;

type QdrantPoint = Schemas['PointStruct'];

function toQdrantId(mongoId: unknown): string {
  return uuidv5(String(mongoId ?? 'unknown'), UUID_NAMESPACE);
}

async function initCollection(): Promise<number> {
  const testEmbedding = await generateEmbedding('test');
  const dims = testEmbedding.length;

  const { exists } = await qdrant.collectionExists(COLLECTION_NAME);
  if (exists) {
    const info = await qdrant.getCollection(COLLECTION_NAME);
    const existingDims = (info.config?.params?.vectors as { size?: number } | undefined)?.size;
    if (existingDims && existingDims !== dims) {
      console.log(`  Collection has ${existingDims} dims but model returns ${dims} — recreating...`);
      await qdrant.deleteCollection(COLLECTION_NAME);
      await qdrant.createCollection(COLLECTION_NAME, { vectors: { size: dims, distance: 'Cosine' } });
    }
  } else {
    await qdrant.createCollection(COLLECTION_NAME, { vectors: { size: dims, distance: 'Cosine' } });
  }
  return dims;
}

function buildSearchableText(product: Record<string, unknown>): string {
  const categories = Array.isArray(product['categories'])
    ? (product['categories'] as string[]).join(' | ')
    : String(product['categories'] ?? '');

  return [
    product['product_name']        ?? '',
    product['product_name_en']     ?? '',
    product['brands']              ?? '',
    categories,
    product['ingredients_text']    ?? '',
    product['ingredients_text_en'] ?? '',
    product['product_type'] === 'beauty' ? 'skincare cosmetics beauty product' : '',
  ]
    .map(s => (typeof s === 'string' ? s : String(s)).trim())
    .filter(Boolean)
    .join(' | ');
}

async function flushBatch(points: QdrantPoint[], synced: number): Promise<void> {
  if (points.length === 0) return;
  await qdrant.upsert(COLLECTION_NAME, { points });
  points.length = 0;
  console.log(`  Synced ${synced} products...`);
}

export async function vectorizeProducts(limit = 0): Promise<void> {
  console.log(`  Initialising Qdrant collection...`);
  const dims = await initCollection();
  console.log(`  Embedding dimensions: ${dims}`);

  const mongoDb = await getDb();
  const total   = await mongoDb.collection('products').countDocuments();
  console.log(`  Products in MongoDB: ${total}`);

  const cursor = mongoDb.collection('products').find({});
  let count    = 0;
  const points: QdrantPoint[]         = [];
  const batch:  Promise<QdrantPoint>[] = [];

  for await (const product of cursor) {
    const p = product as Record<string, unknown>;
    batch.push(
      generateEmbedding(buildSearchableText(p)).then((vector): QdrantPoint => ({
        id:      toQdrantId(p['_id'] ?? p['code']),
        vector,
        payload: {
          mongo_id:     String(p['_id'] ?? p['code']),
          code:         p['code'],
          product_name: p['product_name'] ?? p['product_name_en'],
          brands:       p['brands'],
          categories:   p['categories'],
          ingredients:  p['ingredients_text'] ?? p['ingredients_text_en'],
          countries:    p['countries'],
          product_type: p['product_type'],
          completeness: p['completeness'],
        },
      })),
    );

    if (batch.length >= CONCURRENCY) {
      const results = await Promise.all(batch);
      batch.length = 0;
      points.push(...results);
      count += results.length;
      if (count % BATCH_SIZE === 0) await flushBatch(points, count);
    }

    if (limit && count >= limit) break;
  }

  if (batch.length > 0) {
    const results = await Promise.all(batch);
    points.push(...results);
    count += results.length;
  }
  await flushBatch(points, count);

  const countRes   = await qdrant.count(COLLECTION_NAME);
  const pointCount = typeof countRes === 'number' ? countRes : (countRes as { count?: number }).count ?? 0;
  console.log(`  Qdrant now holds ${pointCount} vectors (synced ${count} this run).`);
}

if (require.main === module) {
  const rawLimit = process.argv[2];
  const limit    = rawLimit ? Number.parseInt(rawLimit, 10) : 0;
  if (rawLimit && Number.isNaN(limit)) {
    console.error('Invalid limit:', rawLimit);
    process.exit(2);
  }
  vectorizeProducts(limit)
    .then(() => closeDb())
    .catch(err => { console.error('[04-vectorize] Failed:', err); process.exit(1); });
}
