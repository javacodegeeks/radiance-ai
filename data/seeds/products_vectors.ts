import { getDb, closeDb } from '../src/mongo';
import { qdrant, generateEmbedding } from '../src/qdrant';
import { toQdrantId } from '../src/repositories/productRepository';

const COLLECTION_NAME = 'products';

const BATCH_SIZE = 100;
const CONCURRENCY = 5;

export async function initQdrantCollection(): Promise<number> {
  // Auto-detect dims from actual model output — never trust env var alone
  const testEmbedding = await generateEmbedding('test');
  const dims = testEmbedding.length;

  const { exists } = await qdrant.collectionExists(COLLECTION_NAME);

  if (exists) {
    const info = await qdrant.getCollection(COLLECTION_NAME);
    const existingDims = (info.config?.params?.vectors as any)?.size as number | undefined;
    if (existingDims && existingDims !== dims) {
      console.log(`Collection has ${existingDims} dims but model returns ${dims} — recreating...`);
      await qdrant.deleteCollection(COLLECTION_NAME);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: { size: dims, distance: 'Cosine' },
      });
    }
  } else {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: dims, distance: 'Cosine' },
    });
  }

  return dims;
}

function buildSearchableText(product: any): string {
  const categories = Array.isArray(product.categories)
    ? product.categories.join(' | ')
    : product.categories;

  return `
    ${product.product_name ?? ''}
    ${product.product_name_en ?? ''}
    ${product.brands ?? ''}
    ${categories ?? ''}
    ${product.ingredients_text ?? ''}
    ${product.ingredients_text_en ?? ''}
    ${product.product_type === 'beauty' ? 'skincare cosmetics beauty product' : ''}
  `
    .split(/\r?\n/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(' | ');
}

async function flushPoints(points: any[], count: number) {
  if (points.length === 0) return;

  await qdrant.upsert(COLLECTION_NAME, { points });
  points.length = 0;
  console.log(`Synced ${count} products...`);
}

async function buildPoint(product: any) {
  const qdrantId = toQdrantId(product._id || product.code);

  const payload = {
    mongo_id: String(product._id || product.code),
    code: product.code,
    product_name: product.product_name || product.product_name_en,
    brands: product.brands,
    categories: product.categories,
    ingredients: product.ingredients_text || product.ingredients_text_en,
    countries: product.countries,
    product_type: product.product_type,
    completeness: product.completeness,
  };

  const vector = await generateEmbedding(buildSearchableText(product));

  return { id: qdrantId, vector, payload };
}

export async function syncProductsToQdrant(limit = 0) {
  console.log(`Syncing ${limit || 'all'} products to Qdrant...`);

  const dims = await initQdrantCollection();
  console.log(`Embedding dimensions: ${dims}`);

  const mongoDb = await getDb();

  const documentsCounts = mongoDb.collection('products').countDocuments();
  console.log(`Total products in MongoDB: ${await documentsCounts}`);

  const cursor = mongoDb.collection('products').find({});

  let count = 0;
  const points: any[] = [];
  const batch: Promise<any>[] = [];

  for await (const product of cursor) {
    batch.push(buildPoint(product));

    if (batch.length >= CONCURRENCY) {
      const results = await Promise.all(batch);
      batch.length = 0;

      for (const point of results) {
        points.push(point);
        count++;
      }

      if (count % BATCH_SIZE === 0) {
        await flushPoints(points, count);
      }
    }

    if (limit && count >= limit) break;
  }

  if (batch.length > 0) {
    const results = await Promise.all(batch);
    for (const point of results) {
      points.push(point);
      count++;
    }
  }

  await flushPoints(points, count);

  console.log(`Successfully synced ${count} products to Qdrant!`);
}

export async function verifyQdrantSync(expectedCount?: number) {
  console.log('\nVerifying Qdrant sync...');

  const exists = await qdrant.collectionExists(COLLECTION_NAME);
  if (!exists.exists) {
    console.warn(`Qdrant collection '${COLLECTION_NAME}' does not exist.`);
    return false;
  }

  const countResponse = await qdrant.count(COLLECTION_NAME);
  const pointCount = typeof countResponse === 'number'
    ? countResponse
    : (countResponse as any).count ?? 0;

  console.log(`Qdrant point count: ${pointCount}`);

  if (expectedCount && expectedCount > 0) {
    if (pointCount >= expectedCount) {
      console.log(`Qdrant has at least ${expectedCount} synced points.`);
    } else {
      console.warn(`Expected ${expectedCount} points, but found ${pointCount}.`);
    }
  }

  return pointCount > 0;
}

async function main() {
  const raw = process.argv[2];
  const limit = raw ? Number.parseInt(raw, 10) : 0;

  if (raw && Number.isNaN(limit)) {
    console.error('Invalid numeric limit:', raw);
    process.exit(2);
  }

  try {
    await syncProductsToQdrant(limit);
    await verifyQdrantSync(limit || undefined);
  } catch (err) {
    console.error('Error syncing products to Qdrant:', err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
