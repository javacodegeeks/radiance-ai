import { GraphStateType } from '../graph/state';
import { Product, RecommendedProduct } from '../types';
import { getSafetyRulesForIngredients } from '../tools/safetyRulesLookup';

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
  // If no INCI data we cannot verify — flag as caution
  if (!product.inci.length) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  'Ingredient list unavailable — verify before purchase.',
      relevanceScore: 0.5,
    };
  }

  const violations = await getSafetyRulesForIngredients(product.inci, userConditions);

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

  return { ...product, safetyStatus: 'safe', relevanceScore: 1.0 };
}
