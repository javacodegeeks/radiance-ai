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
import { normalizeCountries } from '../src/common/countryNormalizer';

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

function normalizeData(data: string | string[] | null | undefined): string {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data.trim();
  }

  const entries = (data as string[])
    .map(item => String(item).trim())
    .filter(Boolean)
    .map(entry => {
      const datum = entry.includes(':') ? entry.split(':')[1].trim() : entry;
      return datum.replaceAll("-", " ").toLowerCase().trim();
    })
    .filter(Boolean);

  return entries.join(' | ');
}

function buildSearchableText(product: Record<string, unknown>): string {
  const categories = normalizeData((product['categories'] ?? product['categories_tags']) as string | string[] | undefined);
  const ingredients = normalizeData((product['ingredients_text'] ?? product['ingredients_text_en']) as string | string[] | undefined);
  const brands = normalizeData((product['brands'] ?? product['brands_tags']) as string | string[] | undefined);
  const labels = normalizeData(product['labels_tags'] as string | string[] | undefined);
  return [
    product['product_name']        ?? '',
    product['product_name_en']     ?? '',
    product['product_type']        ?? '',
    brands,
    categories,
    ingredients,
    labels,
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

async function findExistingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const records = await qdrant.retrieve(COLLECTION_NAME, { ids, with_payload: false, with_vector: false });
  return new Set(records.map(r => String(r.id)));
}

async function embedCandidate(product: Record<string, unknown>, qdrantId: string): Promise<QdrantPoint> {
  const p = product;
  const [vector, countries] = await Promise.all([
    generateEmbedding(buildSearchableText(p)),
    normalizeCountries((p['countries'] ?? p['countries_tags']) as string | string[] | undefined),
  ]);
  return {
    id:      qdrantId,
    vector,
    payload: {
      mongo_id:     String(p['_id'] ?? p['code']),
      code:         p['code'],
      product_name: p['product_name'] ?? p['product_name_en'],
      brands:       normalizeData((p['brands'] ?? p['brands_tags']) as string | string[] | undefined),
      categories:   normalizeData((p['categories'] ?? p['categories_tags']) as string | string[] | undefined),
      ingredients:  normalizeData((p['ingredients_text'] ?? p['ingredients_text_en'] ?? p['ingredients_tags']) as string | string[] | undefined),
      labels:       normalizeData(p['labels_tags'] as string | string[] | undefined),
      countries,
      product_type: p['product_type'],
      completeness: p['completeness'],
    },
  };
}

export async function vectorizeProducts(limit = 0): Promise<void> {
  console.log(`  Initialising Qdrant collection...`);
  const dims = await initCollection();
  console.log(`  Embedding dimensions: ${dims}`);

  const mongoDb = await getDb();
  const total   = await mongoDb.collection('products').estimatedDocumentCount();
  console.log(`  Products in MongoDB: ${total}`);

  const cursor = mongoDb.collection('products').find({});
  let processed = 0;
  let synced    = 0;
  let skipped   = 0;
  const points: QdrantPoint[] = [];
  let candidates: Array<{ product: Record<string, unknown>; qdrantId: string }> = [];

  const processCandidates = async (): Promise<void> => {
    if (candidates.length === 0) return;
    const batch = candidates;
    candidates = [];

    const existingIds = await findExistingIds(batch.map(c => c.qdrantId));
    const toEmbed = batch.filter(c => !existingIds.has(c.qdrantId));
    skipped += batch.length - toEmbed.length;

    for (let i = 0; i < toEmbed.length; i += CONCURRENCY) {
      const chunk = toEmbed.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(c => embedCandidate(c.product, c.qdrantId)));
      points.push(...results);
      synced += results.length;
      if (points.length >= BATCH_SIZE) await flushBatch(points, synced);
    }
  };

  for await (const product of cursor) {
    const p = product as Record<string, unknown>;

    // OFF (Open Food Facts) and OBF (Open Beauty Facts) dumps are restored into
    // the same collection — skip food items, they're irrelevant to a cosmetic
    // recommender and have no consumer anywhere in ai/src.
    if (p['product_type'] === 'food') continue;

    candidates.push({ product: p, qdrantId: toQdrantId(p['_id'] ?? p['code']) });
    processed++;

    if (candidates.length >= BATCH_SIZE) await processCandidates();
    if (limit && processed >= limit) break;
  }

  await processCandidates();
  await flushBatch(points, synced);

  const countRes   = await qdrant.count(COLLECTION_NAME);
  const pointCount = typeof countRes === 'number' ? countRes : (countRes as { count?: number }).count ?? 0;
  console.log(`  Qdrant now holds ${pointCount} vectors (synced ${synced}, skipped ${skipped} this run).`);
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
