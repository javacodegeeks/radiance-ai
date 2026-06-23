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
  questioner:    { model: MODEL, temperature: 0,   max_tokens: 1024 },
  /** Slightly creative — personalised product explanations. */
  recommender:   { model: MODEL, temperature: 0.3, max_tokens: 2048 },
  /** Short deterministic extraction — brand name from web content. */
  webResearcher: { model: MODEL, temperature: 0,   max_tokens: 50   },
  /** Short deterministic extraction — INCI ingredient list from query. */
  productFinder: { model: MODEL, temperature: 0,   max_tokens: 150  },
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
  choices: Array<{ message: { content: string | null } }>;
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
  const res = await fetch(`${process.env.LITELLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.LITELLM_API_KEY}`,
    },
    body: JSON.stringify({ ...PRESETS[preset], messages }),
  });

  if (!res.ok) {
    throw new Error(`LiteLLM chat request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as ChatCompletionResponse;
  return json.choices[0]?.message?.content ?? '';
}
