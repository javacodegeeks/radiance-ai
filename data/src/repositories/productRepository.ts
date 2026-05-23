import { Pool } from 'pg';
import { getDb } from '../db';

export interface ProductRow {
  id: string;
  name: string;
  brand?: string;
  inci?: string[];
  categories?: string[];
  country_availability?: string[];
  source_url?: string;
  embedding?: number[];
  is_pre_vetted: boolean;
  cached_at: Date;
}

export class ProductRepository {
  private db: Pool;

  constructor(db?: Pool) {
    this.db = db ?? getDb();
  }

  /** ANN cosine-similarity search. Falls back gracefully when no embedding exists. */
  async findSimilar(embedding: number[], limit = 5, country?: string): Promise<ProductRow[]> {
    const params: unknown[] = [JSON.stringify(embedding), limit];
    const countryClause = country
      ? (() => { params.push(country); return `AND $${params.length} = ANY(country_availability)`; })()
      : '';

    const result = await this.db.query<ProductRow>(
      `SELECT id, name, brand, inci, categories, country_availability, source_url, is_pre_vetted, cached_at
       FROM products
       WHERE embedding IS NOT NULL ${countryClause}
       ORDER BY embedding <=> $1
       LIMIT $2`,
      params,
    );
    return result.rows;
  }

  async upsertCached(product: Omit<ProductRow, 'id' | 'cached_at'>): Promise<ProductRow> {
    const embeddingValue = product.embedding ? JSON.stringify(product.embedding) : null;

    const result = await this.db.query<ProductRow>(
      `INSERT INTO products
         (name, brand, inci, categories, country_availability, source_url, embedding, is_pre_vetted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING id, name, brand, inci, categories, country_availability, source_url, is_pre_vetted, cached_at`,
      [
        product.name,
        product.brand             ?? null,
        product.inci              ?? null,
        product.categories        ?? null,
        product.country_availability ?? null,
        product.source_url        ?? null,
        embeddingValue,
        product.is_pre_vetted,
      ],
    );
    return result.rows[0];
  }
}
