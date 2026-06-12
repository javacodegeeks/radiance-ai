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
  sessionId: string;
  country?: string;
  skinType?: string;
  /** Normalised ingredient names the user is allergic to, e.g. 'fragrance', 'nut_allergy' */
  allergies?: string[];
  /** Conditions that drive safety filtering: 'pregnancy', 'rosacea', etc. */
  conditions?: string[];
  /** Stated cosmetic concerns: 'acne', 'dryness', 'hair_loss', etc. */
  concerns?: string[];
  consentGiven: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id?: string;
  name: string;
  brand: string;
  /** INCI-formatted ingredient list */
  inci: string[];
  categories: string[];
  countryAvailability: string[];
  sourceUrl?: string;
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

export interface AgentState {
  sessionId: string;
  userQuery: string;
  queryContext: Partial<QueryContext>;
  userProfile: Partial<UserProfile>;
  conversationHistory: Message[];
  pendingQuestions: string[];
  profileComplete: boolean;
  webResults: Product[];
  catalogResults: Product[];
  safetyCheckedProducts: RecommendedProduct[];
  finalRecommendations: RecommendedProduct[];
  currentStep: AgentStep;
  iterationCount: number;
  error?: string;
}
