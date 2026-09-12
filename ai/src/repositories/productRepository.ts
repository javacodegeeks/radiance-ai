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

/** OBF/OFF dumps use several image field names depending on data source and product age. */
function toImageUrl(r: ProductDoc): string | undefined {
  const candidates = [r['image_front_url'], r['image_url'], r['image_front_small_url'], r['image_small_url']];
  const found = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return found;
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
    imageUrl:            toImageUrl(r),
    cachedAt:            r['cached_at'] instanceof Date ? r['cached_at'] : undefined,
    category:            r['category'] as Product['category'],
  };
}

type Condition   = Schemas['Condition'];
type QdrantFilter = Schemas['Filter'];
type ScoredPoint  = Awaited<ReturnType<typeof qdrant.search>>[number];

/**
 * Base-catalog condition: matches points with no tenant_id payload key at
 * all — data/pipeline's offline import never sets one. Applied even when
 * no tenantId is resolved, so an admin-added product from one tenant never
 * leaks into another tenant's (or an anonymous session's) results.
 */
function buildFilter(country: string | undefined, tenantScope: 'base' | string): QdrantFilter {
  const must: Condition[] = [];
  if (country) must.push({ key: 'countries', match: { value: country } });
  must.push(
    tenantScope === 'base'
      ? { is_empty: { key: 'tenant_id' } }
      : { key: 'tenant_id', match: { value: tenantScope } },
  );
  return { must };
}

function dedupeByHighestScore(resultSets: ScoredPoint[][], limit: number): ScoredPoint[] {
  const seen = new Set<string>();
  return resultSets
    .flat()
    .sort((a, b) => b.score - a.score)
    .filter(hit => {
      const id = String(hit.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

/**
 * Searches the shared base catalog (tenant_id absent) and, when a tenantId
 * is resolved (see common/tenantContext.ts), unions in that tenant's own
 * additions (tenant_id-filtered) — never the whole catalog re-filtered per
 * tenant. See "Resolved — catalog ownership is (b)" in the multi-tenancy
 * spec section.
 */
export async function findSimilarProducts(
  embedding: number[],
  limit = 5,
  country?: string,
  tenantId?: string,
): Promise<Product[]> {
  const searchRequest = (filter: QdrantFilter): Schemas['SearchRequest'] => ({
    vector: embedding,
    limit,
    with_payload: true,
    filter,
  });

  let hits: ScoredPoint[];
  try {
    const searches = [qdrant.search(COLLECTION_NAME, searchRequest(buildFilter(country, 'base')))];
    if (tenantId) searches.push(qdrant.search(COLLECTION_NAME, searchRequest(buildFilter(country, tenantId))));

    const resultSets = await Promise.all(searches);
    hits = dedupeByHighestScore(resultSets, limit);
    console.log(`[productRepository] Qdrant search returned ${hits.length} hit(s)${country ? ` (country=${country})` : ''}${tenantId ? ` (tenant=${tenantId})` : ''}`);
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
