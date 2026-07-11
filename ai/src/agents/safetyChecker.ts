import { GraphStateType } from '../graph/state';
import { Product, RecommendedProduct } from '../types';
import { findSafetyViolations } from '../repositories/safetyRulesRepository';
import { RepositoryError } from '../common/errors';

/**
 * Below this many ingredient/allergen signals, "no violations found" is not
 * a reliable "safe" verdict — the product's underlying data (INCI text,
 * allergens_tags) is too sparse to say the rule lookup had a fair chance.
 * See data/pipeline/02-seed-safety.ts for why sparse data is common here.
 */
const MIN_RELIABLE_INGREDIENT_COUNT = 5;

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
  // Merge free-text INCI with structured allergen tags (e.g. OBF's EU fragrance
  // allergens) — allergens_tags is cleaner/more reliable than parsing raw INCI text.
  const ingredientSignals = [...product.inci, ...(product.allergens ?? [])];

  // If no ingredient data at all we cannot verify — flag as caution
  if (!ingredientSignals.length) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  'Ingredient list unavailable — verify before purchase.',
      relevanceScore: 0.5,
    };
  }

  let violations;
  try {
    violations = await findSafetyViolations(ingredientSignals, userConditions);
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

  const hasCriticalOrHigh = violations.some(
    v => v.severity === 'critical' || v.severity === 'high',
  );

  if (hasCriticalOrHigh) {
    return {
      ...product,
      safetyStatus: 'unsafe',
      safetyNotes:  violations.map(v => v.notes).filter(Boolean).join('; '),
      relevanceScore: 0,
    };
  }

  if (violations.length) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  violations.map(v => v.notes).filter(Boolean).join('; '),
      relevanceScore: 0.7,
    };
  }

  // No known violations — but with too few ingredient signals, that means
  // "nothing to check against" more often than "confirmed safe".
  if (ingredientSignals.length < MIN_RELIABLE_INGREDIENT_COUNT) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  'Ingredient data is too sparse to confidently rule out risks — verify before purchase.',
      relevanceScore: 0.6,
    };
  }

  return { ...product, safetyStatus: 'safe', relevanceScore: 1.0 };
}
