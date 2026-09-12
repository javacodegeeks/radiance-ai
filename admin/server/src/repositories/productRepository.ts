/**
 * Write side of the shared `products` Mongo collection. Writes using the
 * same OBF-style raw field names ai/src/repositories/productRepository.ts's
 * toProduct() already expects — ai/'s read path needs zero changes since
 * it doesn't care which process wrote the doc.
 */
import { ObjectId } from 'mongodb';
import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'products';

export type AdminProductCategory = 'cleanser' | 'treatment' | 'moisturizer' | 'spf' | 'exfoliant' | 'none';

export interface InsertProductInput {
  productName:     string;
  brands:          string;
  ingredientsText: string;
  categoriesTags:  string[];
  countries:       string[];
  labelsTags:      string[];
  allergensTags:   string[];
  category:        AdminProductCategory;
  tenantId:        string;
  addedByUserId:   string;
}

export async function insertProduct(input: InsertProductInput): Promise<string> {
  console.log(`[productRepository] insertProduct tenant=${input.tenantId} name="${input.productName}" brand="${input.brands}"`);
  try {
    const db = await getDb();
    const result = await db.collection(COLLECTION_NAME).insertOne({
      product_name:      input.productName,
      brands:            input.brands,
      ingredients_text:  input.ingredientsText,
      categories_tags:   input.categoriesTags,
      countries:         input.countries,
      labels_tags:       input.labelsTags,
      allergens_tags:    input.allergensTags,
      category:          input.category === 'none' ? undefined : input.category,
      tenantId:          input.tenantId,
      addedByUserId:     input.addedByUserId,
      cached_at:         new Date(),
    });
    const id = result.insertedId.toHexString();
    console.log(`[productRepository] insertProduct → inserted _id=${id}`);
    return id;
  } catch (err) {
    console.error(`[productRepository] insertProduct failed for tenant=${input.tenantId}`, err);
    throw new RepositoryError('productRepository', 'Failed to insert product', err);
  }
}

/**
 * Searches the shared base catalog (no tenantId field) plus this tenant's
 * own additions — lets the console check for duplicates against everything
 * a consumer in this tenant could actually be recommended, not just the
 * tenant's own additions.
 */
export interface SearchProductsResult {
  products: Record<string, unknown>[];
  total: number;
}

export async function searchProducts(
  q: string,
  tenantId: string,
  page = 1,
  limit = 20,
  onlyOwn = false,
): Promise<SearchProductsResult> {
  const skip = (page - 1) * limit;
  console.log(`[productRepository] searchProducts tenant=${tenantId} q="${q}" page=${page} limit=${limit} onlyOwn=${onlyOwn}`);
  try {
    const db = await getDb();
    // onlyOwn powers the "New products" tab — this tenant's own admin
    // additions only, excluding the shared base catalog.
    const tenantScope = onlyOwn ? { tenantId } : { $or: [{ tenantId: { $exists: false } }, { tenantId }] };
    const textMatch = q
      ? { $or: [{ product_name: { $regex: q, $options: 'i' } }, { brands: { $regex: q, $options: 'i' } }] }
      : {};
    const filter = q ? { $and: [tenantScope, textMatch] } : tenantScope;

    const collection = db.collection(COLLECTION_NAME);
    const [results, total] = await Promise.all([
      collection.find(filter).skip(skip).limit(limit).toArray(),
      collection.countDocuments(filter),
    ]);
    console.log(`[productRepository] searchProducts → ${results.length} result(s) of ${total} total`);
    return { products: results, total };
  } catch (err) {
    console.error(`[productRepository] searchProducts failed for tenant=${tenantId} q="${q}"`, err);
    throw new RepositoryError('productRepository', 'Failed to search products', err);
  }
}

// OBF/OFF-imported docs keep their original barcode as `_id` (a plain
// string, e.g. "0000527000057"), not a Mongo ObjectId — only docs inserted
// by this service's own insertProduct() get an auto-generated ObjectId.
// Mirrors ai/src/repositories/productRepository.ts's buildMongoIdFilter().
export async function findProductById(id: string): Promise<Record<string, unknown> | null> {
  try {
    const db = await getDb();
    const doc = await db.collection(COLLECTION_NAME).findOne(
      ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id },
    );
    console.log(`[productRepository] findProductById id=${id} → ${doc ? 'found' : 'not found'}`);
    return doc;
  } catch (err) {
    console.error(`[productRepository] findProductById failed for id=${id}`, err);
    throw new RepositoryError('productRepository', 'Failed to look up product', err);
  }
}
