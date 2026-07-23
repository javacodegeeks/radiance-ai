import { GraphStateType } from '../graph/state';
import { CosingRestriction, Product, RecommendedProduct } from '../types';
import { findSafetyViolations, getKnownContraindications } from '../repositories/safetyRulesRepository';
import { findCosingRestrictions } from '../repositories/cosingRestrictionsRepository';
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

  // A reported allergy/condition that isn't a known contraindication tag at
  // all (e.g. normalizeAllergies/normalizeConditions had no alias for it, and
  // it also isn't a tag already in the DB) means the rule lookup below has
  // *nothing* to check it against — "no violations found" in that case means
  // "we don't have data for this," not "cleared." Default to true (favor
  // caution) if the lookup itself fails, consistent with other safety-net
  // fallbacks in this agent.
  let hasUnrecognizedConditions = userConditions.length > 0;
  if (userConditions.length > 0) {
    try {
      const knownTags = await getKnownContraindications();
      hasUnrecognizedConditions = userConditions.some(c => !knownTags.has(c));
    } catch (err) {
      console.warn('[safetyChecker] failed to load known contraindication tags — defaulting to caution', err);
    }
  }

  console.log(`[safetyChecker] checking ${allProducts.length} product(s) against conditions: [${userConditions.join(', ') || 'none'}] (unrecognized=${hasUnrecognizedConditions})`);

  const checked = await Promise.all(
    allProducts.map(p => assessProduct(p, userConditions, hasUnrecognizedConditions)),
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
  hasUnrecognizedConditions: boolean,
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

  // EU-regulated (CosIng Annex III) restrictions apply regardless of the
  // user's specific allergies/conditions — a general caution signal, not a
  // condition-specific violation. Non-fatal: failure here shouldn't override
  // the allergy-based verdict already computed above.
  const cosingRestrictions = await checkCosingRestrictions(ingredientSignals, product.name);
  const cosingNote = describeCosingRestrictions(cosingRestrictions);

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
      safetyNotes:  [violations.map(v => v.notes).filter(Boolean).join('; '), cosingNote].filter(Boolean).join(' '),
      relevanceScore: 0.7,
    };
  }

  // No known violations — but if something the user reported isn't a
  // recognized contraindication tag at all, "no violations" means "not
  // checked," not "cleared."
  if (hasUnrecognizedConditions) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  ['Some reported allergies/conditions are not yet in our safety database — verify before purchase.', cosingNote].filter(Boolean).join(' '),
      relevanceScore: 0.6,
    };
  }

  // No known violations — but with too few ingredient signals, that means
  // "nothing to check against" more often than "confirmed safe".
  if (ingredientSignals.length < MIN_RELIABLE_INGREDIENT_COUNT) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  ['Ingredient data is too sparse to confidently rule out risks — verify before purchase.', cosingNote].filter(Boolean).join(' '),
      relevanceScore: 0.6,
    };
  }

  if (cosingRestrictions.length) {
    return {
      ...product,
      safetyStatus: 'caution',
      safetyNotes:  cosingNote,
      relevanceScore: 0.7,
    };
  }

  return { ...product, safetyStatus: 'safe', relevanceScore: 1.0 };
}

async function checkCosingRestrictions(ingredientSignals: string[], productName: string): Promise<CosingRestriction[]> {
  try {
    return await findCosingRestrictions(ingredientSignals);
  } catch (err) {
    console.warn(`[safetyChecker] CosIng restriction lookup failed for "${productName}" — skipping this check`, err);
    return [];
  }
}

function describeCosingRestrictions(restrictions: CosingRestriction[]): string {
  if (!restrictions.length) return '';
  const parts = restrictions.map(r => {
    const detail = r.maxConcentration ? `max concentration ${r.maxConcentration}` : 'usage restrictions apply';
    return `${r.ingredient} is EU-regulated (CosIng Annex III #${r.referenceNumber}, ${detail})`;
  });
  return `${parts.join('; ')}.`;
}
