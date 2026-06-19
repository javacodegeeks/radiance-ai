// ─── UI-level types ───────────────────────────────────────────────────────────
// Deliberately independent of the AI layer's internal types so this package
// can be extracted or used standalone without the ai/ dependency.

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface RecommendationResult {
  name: string;
  brand: string;
  categories: string[];
  countryAvailability: string[];
  sourceUrl?: string;
  safetyStatus: 'safe' | 'caution' | 'unsafe';
  safetyNotes?: string;
  relevanceScore: number;
  availabilityNotes?: string;
  relevanceToQuery?: string;
  reasoning?: string;
  usageTips?: string[];
}

export type ChatPhase = 'collecting' | 'questioning' | 'processing' | 'done' | 'error';

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export interface ChatResponse {
  messages: ChatMessage[];
  phase: ChatPhase;
  recommendations?: RecommendationResult[];
  error?: string;
}
