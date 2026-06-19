/**
 * AI layer adapter — the single plug point between the UI and the graph engine.
 *
 * Plug-and-play modes (set via environment variables):
 *
 *   Monorepo (default): AI_BACKEND_URL is unset.
 *     run() is imported from the compiled radiance-ai-core package.
 *     Prerequisites: cd ../ai && npm run build
 *
 *   Remote service:     AI_BACKEND_URL=https://api.yourapp.com
 *     The call is forwarded to POST {AI_BACKEND_URL}/run as JSON.
 *     Use this when extracting the AI layer into its own service.
 *
 * No other file in the UI needs to change when switching modes.
 */

// ─── Shared DTO types (mirrored to avoid cross-package coupling) ──────────────

export interface RunOptions {
  sessionId: string;
  userQuery: string;
  existingProfile?: {
    country?: string;
    skinType?: string;
    allergies?: string[];
    conditions?: string[];
  };
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: Date }>;
}

export interface RecommendedProductDTO {
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

export interface GraphResult {
  finalRecommendations: RecommendedProductDTO[];
  pendingQuestions: string[];
  currentStep: string;
  error?: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export async function invokeGraph(options: RunOptions): Promise<GraphResult> {
  const backendUrl = process.env.AI_BACKEND_URL;

  if (backendUrl) {
    // ── Remote mode ───────────────────────────────────────────────────────────
    const response = await fetch(`${backendUrl}/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(options),
    });
    if (!response.ok) {
      throw new Error(`AI backend responded with HTTP ${response.status}`);
    }
    return response.json() as Promise<GraphResult>;
  }

  // ── Monorepo mode ─────────────────────────────────────────────────────────
  // Dynamic require keeps this module tree-shakeable on the client side and
  // avoids Next.js attempting to bundle Node.js-only LangGraph internals.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { run } = require('radiance-ai-core') as {
    run: (opts: RunOptions) => Promise<GraphResult>;
  };
  return run(options);
}
