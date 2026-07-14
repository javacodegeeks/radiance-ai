import { z } from 'zod';
import { RecommendedProduct } from '../../types';
import { llmClient, llmConfig } from '../../llm/client';

/**
 * Zod Schema for strict validation
 */
const LLMSafetyResponseSchema = z.object({
  soft_warnings: z
    .array(
      z.object({
        productName: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type LLMSafetyResponse = z.infer<typeof LLMSafetyResponseSchema>;

/**
 * Layer 2 Safety (LLM-based)
 *
 * Rules:
 * - NEVER override 'unsafe'
 * - Can downgrade 'safe' → 'caution'
 * - Can enrich safetyNotes
 * - Must pass schema validation
 */
export async function applyLLMSafetyLayer(
  products: RecommendedProduct[],
): Promise<{
  updated: RecommendedProduct[];
  confidence: number;
}> {
  if (!products.length) {
    return { updated: [], confidence: 1 };
  }

  let parsed: LLMSafetyResponse | null = null;

  try {
    const response = await llmClient.chat.completions.create({
      model: llmConfig.model,
      temperature: 0, // deterministic bias
      max_tokens: llmConfig.max_tokens,
      messages: [
        {
          role: 'system',
          content: `
You are a skincare safety assistant.

Rules:
- NEVER override unsafe products
- Only add contextual warnings
- You may downgrade "safe" → "caution"
- Be concise and factual

Return ONLY valid JSON:
{
  "soft_warnings": [
    { "productName": "string", "reason": "string" }
  ],
  "confidence": number
}
          `,
        },
        {
          role: 'user',
          content: JSON.stringify(products),
        },
      ],
    });

    let content = response.choices[0]?.message?.content || '{}';

    // Clean possible markdown wrappers
    content = content.replace(/```json|```/g, '').trim();

    const json = JSON.parse(content);

    // Strict validation
    const result = LLMSafetyResponseSchema.safeParse(json);

    if (!result.success) {
      console.error('LLM Safety schema validation failed:', result.error);
      return {
        updated: products,
        confidence: 0.5,
      };
    }

    parsed = result.data;
  } catch (err) {
    console.error('LLM Safety Layer error:', err);
    return {
      updated: products,
      confidence: 0.5,
    };
  }

  const updated = products.map((p) => {
    // NEVER TOUCH unsafe products
    if (p.safetyStatus === 'unsafe') return p;

    const match = parsed?.soft_warnings?.find(
      (w) => w.productName === p.name,
    );

    if (match) {
      return {
        ...p,
        safetyStatus: 'caution',
        safetyNotes: p.safetyNotes
          ? `${p.safetyNotes}; ${match.reason}`
          : match.reason,
      };
    }

    return p;
  });

  return {
    updated,
    confidence: parsed?.confidence ?? 0.7,
  };
}
