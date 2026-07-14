import { GraphStateType } from '../graph/state';
import { Product, RecommendedProduct, SafetyRule } from '../types';
import { findSafetyViolations } from '../repositories/safetyRulesRepository';
import { RepositoryError } from '../common/errors';
import { chatCompletion, stripJsonFences } from '../llm/client';
import { z } from 'zod';

// SafetyReport structure
interface SafetyReport {
  approved: boolean;
  soft_warnings: string[];
  hard_blocks: string[];
  overall_safety_confidence: number;
}

// Zod schema for LLM response
const LLMSafetySchema = z.object({
  warnings: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
});

// inferred type
type LLMSafetyResponse = z.infer<typeof LLMSafetySchema>;

/**
 * Layer 2 — LLM Safety Reasoning (with Zod validation)
 */
async function runLLMSafetyReasoning(input: {
  product: Product;
  userConditions: string[];
  existingViolations: SafetyRule[];
}): Promise<LLMSafetyResponse> {
  try {
    const messages = [
      {
        role: 'system' as const,
        content: `
You are a cosmetic safety analysis assistant.

Return STRICT JSON ONLY:
{
  "warnings": string[],
  "riskLevel": "low" | "medium" | "high",
  "confidence": number (0-1)
}
        `.trim(),
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          productName: input.product.name,
          ingredients: input.product.inci,
          userConditions: input.userConditions,
          knownViolations: input.existingViolations,
        }),
      },
    ];

    const raw = await chatCompletion('questioner', messages);
    const cleaned = stripJsonFences(raw);

    // Safe JSON parse
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new Error('Invalid JSON from LLM');
    }
   
   
    // Zod validation
    const result = LLMSafetySchema.safeParse(parsedJson);

    if (!result.success) {
      console.warn('[safetyChecker] LLM schema validation failed', result.error);

      // fallback if schema invalid
      return {
        warnings: ['Uncertain safety due to invalid LLM response'],
        riskLevel: 'medium',
        confidence: 0.5,
      };
    }

    return result.data;
  } catch (err) {
    console.error('[safetyChecker] LLM reasoning failed, fallback applied', err);

    return {
      warnings: ['Unable to fully assess contextual risks'],
      riskLevel: 'medium',
      confidence: 0.5,
    };
  }
} 
/**
 * Safety Checker agent.
 * Validates every product candidate against the user's profile.
 * Products marked 'unsafe' are filtered out; 'caution' products are kept with notes.
 * Deterministic rule lookup + LLM reasoning (TODO for caution edge-cases).
 */
export async function safetyCheckerAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { webResults, catalogResults, userProfile } = state;

  const allProducts = [...webResults, ...catalogResults];
  const userConditions: string[] = [
    ...(userProfile.allergies  ?? []),
    ...(userProfile.conditions ?? []),
  ];

  console.log(`[safetyChecker] checking ${allProducts.length} product(s) against conditions: [${userConditions.join(', ') || 'none'}]`);

  const checked = await Promise.all(
    allProducts.map(p => assessProduct(p, userConditions)),
  );

  const safe    = checked.filter(p => p.safetyStatus !== 'unsafe');
  const unsafe  = checked.filter(p => p.safetyStatus === 'unsafe');
  const caution = checked.filter(p => p.safetyStatus === 'caution');
  console.log(`[safetyChecker] safe=${safe.length} caution=${caution.length} unsafe=${unsafe.length}`);
  return { safetyCheckedProducts: safe };
}

async function assessProduct(
  product: Product,
  userConditions: string[],
): Promise<RecommendedProduct> {
    // SafetyReport init
  let report: SafetyReport = {
    approved: true,
    soft_warnings: [],
    hard_blocks: [],
    overall_safety_confidence: 1,
  };
  // If no INCI data we cannot verify — flag as caution
  if (!product.inci.length) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  'Ingredient list unavailable — verify before purchase.',
      relevanceScore: 0.5,
    };
  }

  let violations: SafetyRule[];
  
  try {
    violations = await findSafetyViolations(product.inci, userConditions);
  } catch (err) {
    const label = err instanceof RepositoryError ? 'RepositoryError' : 'Unexpected error';
    console.error(`[safetyChecker] ${label} for "${product.name}" — defaulting to caution`, err);
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  'Safety check unavailable — verify before purchase.',
      relevanceScore: 0.5,
    };
  }

  // Split violations
  const hardBlocks = violations.filter(
    (v) => v.severity === 'critical' || v.severity === 'high',
  );

  const softWarnings = violations.filter(
    (v) => v.severity === 'medium' || v.severity === 'low',
  );

  // Critical → HARD BLOCK
  if (hardBlocks.some((v) => v.severity === 'critical')) {
    return {
      ...product,
      safetyStatus: 'unsafe',
      safetyNotes: hardBlocks.map(v => v.notes || `${v.ingredient} unsafe`).join('; '),
      relevanceScore: 0,
    };
  }

  // High → HARD BLOCK
  if (hardBlocks.length) {
    return {
      ...product,
      safetyStatus: 'unsafe',
      safetyNotes: hardBlocks.map(v => v.notes || `${v.ingredient} unsafe`).join('; '),
      relevanceScore: 0,
    };
  }

  // LAYER 2 (Zod validated)
  const llmResult = await runLLMSafetyReasoning({
    product,
    userConditions,
    existingViolations: violations,
  });

  report.soft_warnings = [
    ...softWarnings.map((v) => v.notes || `${v.ingredient} caution`),
    ...llmResult.warnings,
  ];

  report.approved = report.soft_warnings.length === 0;

  report.overall_safety_confidence =
    violations.length > 0
      ? Math.min(0.85, llmResult.confidence)
      : llmResult.confidence;

  if (!report.approved) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes: report.soft_warnings.join('; '),
      relevanceScore: 0.7,
    };
  }

  return { ...product, safetyStatus: 'safe', relevanceScore: 1.0 };
}
