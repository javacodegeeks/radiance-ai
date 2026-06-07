import { Db, Document, ObjectId } from 'mongodb';
import { Schemas } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import { getDb } from '../mongo';
import { qdrant } from '../qdrant';

// Fixed namespace for consistent UUID generation
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Convert MongoDB ID → Valid Qdrant UUID
export function toQdrantId(mongoId: any): string {
  const idStr = String(mongoId || 'unknown');
  return uuidv5(idStr, UUID_NAMESPACE);
}

export interface ProductDocument extends Document {
  _id: ObjectId | string;
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  categories?: string[];
  countries?: string[];
  ingredients_text?: string;
  ingredients_text_en?: string;
  product_type?: string;
  completeness?: number;
  source_url?: string;
  is_pre_vetted?: boolean;
  embedding?: number[];
  cached_at?: Date;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'products';

export class ProductRepository {
  private readonly dbPromise: Promise<Db>;

  constructor(dbPromise?: Promise<Db>) {
    this.dbPromise = dbPromise ?? getDb();
  }

  private normalizeId(id: unknown): string {
    if (id instanceof ObjectId) return id.toHexString();
    return String(id);
  }

  private buildMongoIdFilter(ids: string[]) {
    const orClauses = ids.map((id) => {
      if (ObjectId.isValid(id)) {
        return { _id: new ObjectId(id) };
      }
      return { code: id };
    });

    return { $or: orClauses };
  }

  async findSimilar(embedding: number[], limit = 5, country?: string): Promise<ProductDocument[]> {
    const filter = country
      ? {
          must: [
            {
              key: 'countries',
              match: { value: country },
            },
          ],
        }
      : undefined;

    const searchRequest: Schemas['SearchRequest'] = {
      vector: embedding,
      limit,
      with_payload: true,
      filter,
    };

    const hits = await qdrant.search(COLLECTION_NAME, searchRequest);
    const mongoIds: string[] = hits
      .map((hit) => {
        const payload = hit.payload as Record<string, unknown> | undefined;
        return payload?.mongo_id as string | undefined;
      })
      .filter((id): id is string => id !== undefined);

    if (!mongoIds.length) return [];

    const db = await this.dbPromise;
    const products = await db
      .collection<ProductDocument>(COLLECTION_NAME)
      .find(this.buildMongoIdFilter(mongoIds))
      .toArray();

    const order = new Map<string, number>(
      mongoIds.map((id, index): [string, number] => [id, index])
    );
    return products.sort((a, b) => {
      const aId = this.normalizeId(a._id);
      const bId = this.normalizeId(b._id);
      return (order.get(aId) ?? 0) - (order.get(bId) ?? 0);
    });
  }

  private async syncProductToQdrant(product: ProductDocument): Promise<void> {
    if (!product.embedding?.length) return;

    const qdrantId = toQdrantId(product._id || product.code);
    const payload = {
      mongo_id: String(product._id || product.code),
      code: product.code,
      product_name: product.product_name || product.product_name_en,
      brands: product.brands,
      categories: product.categories,
      countries: product.countries,
      product_type: product.product_type,
      source_url: product.source_url,
      completeness: product.completeness,
    };

    const upsertPayload: Schemas['PointInsertOperations'] = {
      points: [
        {
          id: qdrantId,
          vector: product.embedding,
          payload,
        },
      ],
    };

    await qdrant.upsert(COLLECTION_NAME, upsertPayload);
  }

  async upsertCached(product: Omit<ProductDocument, '_id' | 'cached_at'>): Promise<ProductDocument> {
    const db = await this.dbPromise;
    const collection = db.collection<ProductDocument>(COLLECTION_NAME);
    const now = new Date();

    const key = product.code ? { code: product.code } : { source_url: product.source_url ?? '' };
    const update = {
      $set: {
        ...product,
        cached_at: now,
      },
    };

    await collection.updateOne(key, update, {
      upsert: true,
    });

    const savedProduct = await collection.findOne(key);
    if (!savedProduct) {
      throw new Error('Failed to retrieve product after upsert into MongoDB');
    }

    await this.syncProductToQdrant(savedProduct);
    return savedProduct;
  }
}
