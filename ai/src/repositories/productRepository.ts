import { ObjectId } from 'mongodb';
import { Schemas } from '@qdrant/js-client-rest';
import { getDb } from '../infra/mongo';
import { qdrant } from '../infra/qdrant';
import { Product } from '../types';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'products';

type ProductDoc = Record<string, unknown> & { _id: ObjectId | string };

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.trim()) return value.split(',').map(s => s.trim());
  return [];
}

/** Strip Open Beauty Facts language prefixes (e.g. "en:fragrance-free" -> "fragrance free"). */
function normalizeTags(value: unknown): string[] {
  return toArray(value)
    .map(tag => (tag.includes(':') ? tag.split(':')[1] : tag))
    .map(tag => tag.replaceAll('-', ' ').trim())
    .filter(Boolean);
}

function normalizeId(id: unknown): string {
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function buildMongoIdFilter(ids: string[]) {
  return {
    $or: ids.map(id =>
      ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { code: id },
    ),
  };
}

function toProduct(r: ProductDoc): Product {
  return {
    name:                String(r['product_name'] || r['product_name_en'] || r['generic_name'] || r['generic_name_en'] || 'Unknown Product'),
    brand:               String(r['brands'] || 'Unknown Brand'),
    inci:                toArray(r['ingredients_text'] || r['ingredients_text_en']),
    categories:          toArray(r['categories']),
    countryAvailability: toArray(r['countries']),
    labels:              normalizeTags(r['labels_tags']),
    allergens:           normalizeTags(r['allergens_tags']),
    cachedAt:            r['cached_at'] instanceof Date ? r['cached_at'] : undefined,
  };
}

export async function findSimilarProducts(
  embedding: number[],
  limit = 5,
  country?: string,
): Promise<Product[]> {
  const filter = country
    ? { must: [{ key: 'countries', match: { value: country } }] }
    : undefined;

  const searchRequest: Schemas['SearchRequest'] = {
    vector: embedding,
    limit,
    with_payload: true,
    filter,
  };

  let hits;
  try {
    hits = await qdrant.search(COLLECTION_NAME, searchRequest);
    console.log(`[productRepository] Qdrant search returned ${hits.length} hit(s)${country ? ` (country=${country})` : ''}`);
  } catch (err) {
    const detail = (err as { data?: unknown })?.data;
    if (detail !== undefined) {
      console.error('[productRepository] Qdrant error detail:', JSON.stringify(detail));
    }
    throw new RepositoryError('productRepository', 'Qdrant vector search failed', err);
  }

  const mongoIds = hits
    .map(hit => (hit.payload as Record<string, unknown> | undefined)?.['mongo_id'] as string | undefined)
    .filter((id): id is string => id !== undefined);

  if (!mongoIds.length) {
    console.log('[productRepository] no mongo_id in Qdrant payloads — returning empty');
    return [];
  }

  let docs;
  try {
    const db = await getDb();
    docs = await db
      .collection<ProductDoc>(COLLECTION_NAME)
      .find(buildMongoIdFilter(mongoIds))
      .toArray();
  } catch (err) {
    throw new RepositoryError('productRepository', 'MongoDB product hydration failed', err);
  }

  const order = new Map(mongoIds.map((id, i): [string, number] => [id, i]));
  return docs
    .sort((a, b) => (order.get(normalizeId(a._id)) ?? 0) - (order.get(normalizeId(b._id)) ?? 0))
    .map(toProduct);
}
