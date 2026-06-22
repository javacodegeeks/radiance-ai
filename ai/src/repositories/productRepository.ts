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
    name:                String(r['product_name'] || r['product_name_en'] || 'Unknown Product'),
    brand:               String(r['brands'] || 'Unknown Brand'),
    inci:                toArray(r['ingredients']),
    categories:          toArray(r['categories']),
    countryAvailability: toArray(r['countries']),
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

  if (!mongoIds.length) return [];

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
