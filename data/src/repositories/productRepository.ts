import { Db, Document, ObjectId } from 'mongodb';
import { getDb } from '../mongo';
import { qdrant } from '../qdrant';

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

    const searchResponse = await qdrant.search(COLLECTION_NAME, {
      vector: embedding,
      limit,
      with_payload: true,
      filter,
    } as any);

    const hits = Array.isArray((searchResponse as any).result)
      ? (searchResponse as any).result
      : (searchResponse as any);

    const ids: string[] = hits.map((hit: any) => this.normalizeId(hit.id));
    if (!ids.length) return [];

    const db = await this.dbPromise;
    const products = await db
      .collection<ProductDocument>(COLLECTION_NAME)
      .find(this.buildMongoIdFilter(ids))
      .toArray();

    const order = new Map<string, number>(ids.map((id, index): [string, number] => [id, index]));
    return products.sort((a, b) => {
      const aId = this.normalizeId(a._id);
      const bId = this.normalizeId(b._id);
      return (order.get(aId) ?? 0) - (order.get(bId) ?? 0);
    });
  }

  private async syncProductToQdrant(product: ProductDocument): Promise<void> {
    if (!product.embedding?.length) return;

    const id = product.code?.toString() || this.normalizeId(product._id);
    const payload = {
      code: product.code,
      product_name: product.product_name || product.product_name_en,
      brands: product.brands,
      categories: product.categories,
      countries: product.countries,
      product_type: product.product_type,
      source_url: product.source_url,
      completeness: product.completeness,
    };

    await qdrant.upsert(COLLECTION_NAME, {
      points: [
        {
          id,
          vector: product.embedding,
          payload,
        },
      ],
    } as any);
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

    const result = await collection.findOneAndUpdate(key, update, {
      upsert: true,
      returnDocument: 'after',
    });

    if (!result || !result.value) {
      throw new Error('Failed to upsert product into MongoDB');
    }

    const savedProduct = result.value as ProductDocument;
    await this.syncProductToQdrant(savedProduct);
    return savedProduct;
  }
}
