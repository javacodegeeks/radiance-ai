export type ProductCategory = 'cleanser' | 'treatment' | 'moisturizer' | 'spf' | 'exfoliant' | 'none';

export const PRODUCT_CATEGORIES: ProductCategory[] = ['cleanser', 'treatment', 'moisturizer', 'spf', 'exfoliant', 'none'];

// Raw OBF-style field names — matches what admin/server/src/repositories/productRepository.ts
// writes to and reads from the shared `products` Mongo collection.
export interface ProductDoc {
  _id: string;
  product_name?: string;
  brands?: string;
  ingredients_text?: string;
  categories_tags?: string[];
  // Raw OBF data stores this inconsistently — sometimes a comma-separated
  // string (e.g. "France", "United States, World"), sometimes an array.
  countries?: string | string[];
  labels_tags?: string[];
  allergens_tags?: string[];
  category?: ProductCategory;
  tenantId?: string;
  addedByUserId?: string;
  cached_at?: string;
}

export interface AddProductPayload {
  productName: string;
  brands: string;
  ingredientsText: string;
  categoriesTags: string[];
  countries: string[];
  labelsTags: string[];
  allergensTags: string[];
  category: ProductCategory;
}

export interface SearchProductsResult {
  products: ProductDoc[];
  total: number;
  page: number;
  limit: number;
}

export interface AddProductResponse {
  mongoId: string;
  qdrantId: string;
}

export interface EmbeddingStatus {
  indexed: boolean;
  payload?: Record<string, unknown>;
  vector?: number[];
}

export interface ReindexResult {
  indexed: boolean;
  qdrantId: string;
}

export interface TenantRecord {
  tenantId: string;
  subdomain: string;
  name: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// EU CosIng / ingredient safety reference data (Postgres, cosmetic_rai db) —
// read-only in admin/web. Raw column names, matching how ProductDoc mirrors
// admin/server/src/repositories/safetyDataRepository.ts's row shapes.
export interface IngredientRecord {
  id: string;
  inci_name: string;
  common_glossary_name: string;
  chemical_name?: string;
  ec_no?: string;
  status: string;
}

export interface CosingFunctionRecord {
  id: string;
  function_name: string;
  function_description?: string;
}

export interface ProhibitedSubstanceRecord {
  id: string;
  ingredient: string;
  reference_number: string;
  regulation?: string;
  cmr?: string;
}

export interface RestrictionRecord {
  id: string;
  ingredient: string;
  annex: string;
  reference_number: string;
  restriction_scope?: string;
  max_concentration?: string;
  conditions_text?: string;
  regulation?: string;
  cmr?: string;
}

export interface SafetyRuleRecord {
  id: string;
  ingredient: string;
  contraindication: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  source?: string;
}
