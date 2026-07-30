/**
 * LLM client — single integration point for the LiteLLM proxy.
 *
 * Agents and services must use chatCompletion() only.
 * All generation params are fully encapsulated here.
 * Swapping providers requires only env-var changes — no agent code changes.
 */

// ─── Generation presets ───────────────────────────────────────────────────────

const MODEL = process.env.LLM_MODEL!;

const PRESETS = {
  /** Deterministic JSON extraction — clarify user concern and profile. */
  questioner: { model: MODEL, temperature: 0, max_tokens: 2048 },
  /** Slightly creative — personalised product explanations. */
  recommender: { model: MODEL, temperature: 0.3, max_tokens: 4096 },
  /** Short deterministic extraction — brand name from web content. */
  webResearcher: { model: MODEL, temperature: 0, max_tokens: 600 },
  /** Short deterministic extraction — INCI ingredient list from query. */
  inci: { model: MODEL, temperature: 0, max_tokens: 800 },
  /** Deterministic — query-focused summary of retrieved PubMed abstracts. */
  evidenceSummary: { model: MODEL, temperature: 0, max_tokens: 800 },
  /** Deterministic — contextual review of safety-flagged products (Layer 2, see agents/safetyChecker.ts). */
  safetyChecker: { model: MODEL, temperature: 0, max_tokens: 3072 },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences that some LLMs wrap around JSON responses.
 * e.g. ```json\n{...}\n``` → {...}
 */
export function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatPreset = keyof typeof PRESETS;

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string | null }; finish_reason?: string }>;
};

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Send a chat completion request using a named preset.
 * Returns the raw content string from the first choice.
 * Throws on network or API errors — callers wrap in LlmCallError.
 */
export async function chatCompletion(
  preset: ChatPreset,
  messages: LlmMessage[],
): Promise<string> {
  console.log(`[llm] preset=${preset} request:`, JSON.stringify(messages, null, 2));

  const res = await fetch(`${process.env.LITELLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LITELLM_API_KEY}`,
    },
    body: JSON.stringify({ ...PRESETS[preset], messages }),
  });

  if (!res.ok) {
    console.error(`[llm] preset=${preset} chat request failed: ${res.status} ${res.statusText}`);
    throw new Error(`LiteLLM chat request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as ChatCompletionResponse;
  if (json.choices[0]?.finish_reason === 'length') {
    console.warn(`[llm] preset=${preset} response truncated by max_tokens — increase the preset limit if this recurs`);
  }
  return json.choices[0]?.message?.content ?? '';
}
