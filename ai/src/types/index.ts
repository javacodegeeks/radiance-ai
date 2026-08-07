// ─── Core domain types ────────────────────────────────────────────────────────

export interface QueryContext {
  /** Detailed description of the issue after clarification by the Questioner */
  refinedIssue: string;
  /** Body area targeted: face, scalp, hands, body, etc. */
  bodyArea?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  duration?: string;
  triggers?: string[];
  previousTreatments?: string[];
  /** e.g. "reduce redness", "hydrate", "stop hair loss" */
  goals: string[];
}

export interface UserProfile {
  country?: string;
  skinType?: string;
  /** Normalised ingredient names the user is allergic to, e.g. 'fragrance', 'nut_allergy' */
  allergies?: string[];
  /** Conditions that drive safety filtering: 'pregnancy', 'rosacea', etc. */
  conditions?: string[];
  /** Stated cosmetic concerns: 'acne', 'dryness', 'hair_loss', etc. */
  concerns?: string[];
}

export interface Product {
  id?: string;
  name: string;
  brand: string;
  /** INCI-formatted ingredient list */
  inci: string[];
  categories: string[];
  countryAvailability: string[];
  /** Product claims, e.g. 'hypoallergenic', 'fragrance free', 'vegan' */
  labels?: string[];
  /** Structured allergen tags (e.g. EU fragrance allergens like 'linalool', 'limonene') — more reliable than free-text INCI parsing */
  allergens?: string[];
  sourceUrl?: string;
  imageUrl?: string;
  embedding?: number[];
  cachedAt?: Date;
}

export interface SafetyRule {
  id: string;
  ingredient: string;
  contraindication: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
}

/** EU CosIng Annex III/IV/V entry — a regulated ingredient allowed with usage restrictions. */
export interface CosingRestriction {
  id: string;
  ingredient: string;
  annex: string;
  referenceNumber: string;
  restrictionScope?: string;
  maxConcentration?: string;
  conditionsText?: string;
  regulation?: string;
}

/** EU CosIng Annex II entry — a substance prohibited outright in cosmetic products. */
export interface CosingProhibitedSubstance {
  id: string;
  ingredient: string;
  referenceNumber: string;
  regulation?: string;
  cmr?: string;
}

/**
 * Structured output of the two-layer safety checker (see agents/safetyChecker.ts):
 *   hardBlocks — Layer 1 deterministic hard blocks (prohibited substance /
 *     critical-or-high severity violation). Layer 2 never sees these and
 *     cannot move a product out of this bucket.
 *   softWarnings — kept, but flagged: either a Layer 1 signal that isn't an
 *     automatic hard block (medium/low violation, EU usage restriction,
 *     sparse data, unrecognized condition) that Layer 2 judged worth keeping
 *     as a caution, or one Layer 2 couldn't clear (LLM call failed/timed out).
 *   approved — no signals at all, or a Layer 1 signal Layer 2 judged safe to clear.
 */
export interface SafetyReport {
  approved: RecommendedProduct[];
  softWarnings: RecommendedProduct[];
  hardBlocks: RecommendedProduct[];
}

export interface RecommendedProduct extends Product {
  safetyStatus: 'safe' | 'caution' | 'unsafe';
  safetyNotes?: string;
  /** 0–1 composite score combining safety and query relevance */
  relevanceScore: number;
  availabilityNotes?: string;
  /** Why this product addresses the user's specific issue */
  relevanceToQuery?: string;
  /** Detailed reasoning behind the recommendation */
  reasoning?: string;
  /** How to use the product for best results */
  usageTips?: string[];
  /** LLM self-reported 0-100 confidence that this specific product fits this specific user's concern/profile — distinct from relevanceScore, which is a safety-tier ranking proxy, not a user-facing confidence signal */
  confidence?: number;
}

/** A product the Recommender's LLM call excluded, with the safety-signal-grounded reason it gave. */
export interface ExcludedRecommendation {
  name: string;
  reason: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// ─── LangGraph agent state ────────────────────────────────────────────────────

export type AgentStep =
  | 'interview'
  | 'catalog_search'
  | 'web_search'
  | 'safety_check'
  | 'recommend'
  | 'done'
  | 'error';

