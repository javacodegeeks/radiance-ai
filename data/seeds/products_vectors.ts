import { getDb, closeDb } from '../src/mongo';
import { qdrant, generateEmbedding } from '../src/qdrant';
import { toQdrantId } from '../src/repositories/productRepository';

const COLLECTION_NAME = 'products';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function initQdrantCollection() {
  const exists = await qdrant.collectionExists(COLLECTION_NAME);
  
  if (!exists.exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: Number(process.env.EMBEDDING_MODEL_DIMENSIONS ?? 1536) || 1536,
        distance: 'Cosine',
      },
    });
    console.log(`✅ Created Qdrant collection: ${COLLECTION_NAME}`);
  } else {
    console.log(`✅ Qdrant collection '${COLLECTION_NAME}' already exists`);
  }
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

export async function syncProductsToQdrant(limit = 0) {
  console.log(`🔄 Syncing ${limit || 'all'} products to Qdrant...`);
  
  await initQdrantCollection();

  const mongoDb = await getDb();
  const cursor = mongoDb.collection('products').find({});

  let count = 0;
  const points: any[] = [];

  for await (const product of cursor) {
    const qdrantId = toQdrantId(product._id || product.code);

    const payload = {
      mongo_id: String(product._id || product.code),   // Original ID for reference
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

    points.push({
      id: qdrantId,
      vector,
      payload,
    });

    count++;
    if (count % 50 === 0) {
      await qdrant.upsert(COLLECTION_NAME, { points });
      points.length = 0;
      console.log(`✅ Synced ${count} products...`);
    }

    if (limit && count >= limit) break;
  }

  // Upsert remaining points
  if (points.length > 0) {
    await qdrant.upsert(COLLECTION_NAME, { points });
  }

  console.log(`🎉 Successfully synced ${count} products to Qdrant!`);
}

export async function verifyQdrantSync(expectedCount?: number) {
  console.log('\n🔍 Verifying Qdrant sync...');

  const exists = await qdrant.collectionExists(COLLECTION_NAME);
  if (!exists.exists) {
    console.warn(`⚠️ Qdrant collection '${COLLECTION_NAME}' does not exist.`);
    return false;
  }

  const countResponse = await qdrant.count(COLLECTION_NAME);
  const pointCount = typeof countResponse === 'number'
    ? countResponse
    : (countResponse as any).count ?? 0;

  console.log(`📊 Qdrant point count: ${pointCount}`);

  if (expectedCount && expectedCount > 0) {
    if (pointCount >= expectedCount) {
      console.log(`✅ Qdrant has at least ${expectedCount} synced points.`);
    } else {
      console.warn(`⚠️ Expected ${expectedCount} points, but found ${pointCount}.`);
    }
  }

  return pointCount > 0;
}

async function main() {
  const raw = process.argv[2];
  const limit = raw ? parseInt(raw, 10) : 0;

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