/**
 * Thin wrapper around the LiteLLM proxy.
 * All agent code must use this client — never import openai or a provider SDK directly.
 * Switching providers requires only env-var changes (LLM_PROVIDER / LLM_MODEL / LITELLM_BASE_URL).
 */
import OpenAI from 'openai';

export const llmClient = new OpenAI({
  baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4000/v1',
  apiKey:  process.env.LITELLM_API_KEY  ?? 'sk-litellm-master',
});

export const llmConfig = {
  model:       process.env.LLM_MODEL ?? 'gpt-4o-mini',
  temperature: 0.7,
  max_tokens:  2048,
} as const;
