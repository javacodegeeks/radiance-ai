/**
 * addProduct — inserts into Mongo, then embeds + indexes into the shared
 * Qdrant collection. Uses this package's own generateEmbedding/qdrant
 * (src/infra/qdrant.ts), not ai/src/llm/embeddings.ts or
 * data/pipeline/05-vectorize.ts. Builds the same kind of searchable text
 * string 05-vectorize.ts uses, and upserts one Qdrant point with a
 * mongo_id + tenant_id payload, mirroring that script's embedCandidate().
 *
 * Fails loudly — unlike ai/'s recommender "never block on failure"
 * pattern, an admin adding a product needs to know immediately if the
 * write didn't actually happen (see controllers/productController.ts).
 */
import { v5 as uuidv5 } from 'uuid';
import { insertProduct, AdminProductCategory } from '../repositories/productRepository';
import { qdrant, generateEmbedding } from '../infra/qdrant';

// Same fixed namespace data/pipeline/05-vectorize.ts uses, so a product
// added here and later re-synced by the offline pipeline resolves to the
// same deterministic Qdrant point id instead of creating a duplicate.
const UUID_NAMESPACE  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const COLLECTION_NAME = 'products';

export interface AddProductInput {
  productName:     string;
  brands:          string;
  ingredientsText: string;
  categoriesTags:  string[];
  countries:       string[];
  labelsTags:      string[];
  allergensTags:   string[];
  category:        AdminProductCategory;
}

export interface AddProductResult {
  mongoId:  string;
  qdrantId: string;
}

function buildSearchableText(input: AddProductInput): string {
  return [
    input.productName,
    input.brands,
    input.categoriesTags.join(' '),
    input.ingredientsText,
    input.labelsTags.join(' '),
  ]
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');
}

// Mongo docs from the base OBF catalog use raw snake_case fields (see
// ProductDoc) rather than AddProductInput's camelCase shape, and
// categories_tags/labels_tags may already be arrays — same searchable-text
// shape as buildSearchableText() above, just adapted to that input.
function buildSearchableTextFromDoc(doc: Record<string, unknown>): string {
  const asText = (v: unknown) => Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  return [
    asText(doc.product_name),
    asText(doc.brands),
    asText(doc.categories_tags),
    asText(doc.ingredients_text),
    asText(doc.labels_tags),
  ]
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');
}

export async function addProduct(
  input: AddProductInput,
  tenantId: string,
  addedByUserId: string,
): Promise<AddProductResult> {
  console.log(`[productService] addProduct tenant=${tenantId} user=${addedByUserId} name="${input.productName}"`);

  const mongoId  = await insertProduct({ ...input, tenantId, addedByUserId });
  const qdrantId = uuidv5(mongoId, UUID_NAMESPACE);
  console.log(`[productService] addProduct mongoId=${mongoId} → deterministic qdrantId=${qdrantId}`);

  const vector = await generateEmbedding(buildSearchableText(input));

  try {
    await qdrant.upsert(COLLECTION_NAME, {
      points: [{
        id:      qdrantId,
        vector,
        payload: {
          mongo_id:     mongoId,
          tenant_id:    tenantId,
          product_name: input.productName,
          brands:       input.brands,
          categories:   input.categoriesTags.join(' | '),
          ingredients:  input.ingredientsText,
          labels:       input.labelsTags.join(' | '),
          countries:    input.countries,
        },
      }],
    });
  } catch (err) {
    // Mongo write already succeeded — log loudly so this partial-failure
    // state (product exists but isn't searchable/recommendable) is obvious.
    console.error(`[productService] Qdrant upsert failed after Mongo insert succeeded — mongoId=${mongoId} is NOT indexed`, err);
    throw err;
  }

  console.log(`[productService] addProduct → tenant=${tenantId} mongoId=${mongoId} qdrantId=${qdrantId} indexed OK`);
  return { mongoId, qdrantId };
}

/**
 * POST /products/:id/reindex — manual retry/repair for products whose
 * embedding status badge shows "Not indexed" or "Index failed" (most
 * commonly base-catalog OBF docs the offline data/pipeline/05-vectorize.ts
 * hasn't run for yet). Re-embeds from the doc's current Mongo fields and
 * upserts to the same deterministic Qdrant point id addProduct() would have
 * used, so it converges to the same point rather than creating a duplicate.
 * Caller (productController) already fetched `doc` via findProductById and
 * 404'd if missing, so this only handles the embed+upsert step.
 */
export async function reindexProduct(
  mongoId: string,
  doc: Record<string, unknown>,
): Promise<{ qdrantId: string }> {
  const qdrantId = uuidv5(mongoId, UUID_NAMESPACE);
  console.log(`[productService] reindexProduct mongoId=${mongoId} → qdrantId=${qdrantId}`);

  const vector = await generateEmbedding(buildSearchableTextFromDoc(doc));

  try {
    await qdrant.upsert(COLLECTION_NAME, {
      points: [{
        id:      qdrantId,
        vector,
        payload: {
          mongo_id:     mongoId,
          tenant_id:    doc.tenantId as string | undefined,
          product_name: doc.product_name,
          brands:       doc.brands,
          categories:   Array.isArray(doc.categories_tags) ? doc.categories_tags.join(' | ') : doc.categories_tags,
          ingredients:  doc.ingredients_text,
          labels:       Array.isArray(doc.labels_tags) ? doc.labels_tags.join(' | ') : doc.labels_tags,
          countries:    doc.countries,
        },
      }],
    });
  } catch (err) {
    console.error(`[productService] reindexProduct Qdrant upsert failed mongoId=${mongoId}`, err);
    throw err;
  }

  console.log(`[productService] reindexProduct mongoId=${mongoId} qdrantId=${qdrantId} → indexed OK`);
  return { qdrantId };
}

/**
 * GET /products/:id/embedding — a raw ~1536-dim float vector isn't
 * meaningful on its own, so this returns what's actually useful: whether
 * the product has a vector in Qdrant at all, and its stored payload.
 * with_vector only true when explicitly requested (debugging aid).
 */
export async function getProductEmbeddingStatus(
  mongoId: string,
  includeVector = false,
): Promise<{ indexed: boolean; payload?: Record<string, unknown>; vector?: number[] }> {
  const qdrantId = uuidv5(mongoId, UUID_NAMESPACE);
  console.log(`[productService] getProductEmbeddingStatus mongoId=${mongoId} qdrantId=${qdrantId}`);

  let record;
  try {
    [record] = await qdrant.retrieve(COLLECTION_NAME, {
      ids: [qdrantId],
      with_payload: true,
      with_vector: includeVector,
    });
  } catch (err) {
    console.error(`[productService] getProductEmbeddingStatus Qdrant retrieve failed for qdrantId=${qdrantId}`, err);
    throw err;
  }

  if (!record) {
    console.log(`[productService] getProductEmbeddingStatus mongoId=${mongoId} → not indexed`);
    return { indexed: false };
  }
  console.log(`[productService] getProductEmbeddingStatus mongoId=${mongoId} → indexed`);
  return {
    indexed: true,
    payload: record.payload as Record<string, unknown>,
    vector:  includeVector ? (record.vector as number[]) : undefined,
  };
}
