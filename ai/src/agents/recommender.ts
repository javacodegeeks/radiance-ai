import { GraphStateType } from '../graph/state';
import { RecommendedProduct } from '../types';

const MAX_RECOMMENDATIONS = 5;

const SAFETY_WEIGHT: Record<RecommendedProduct['safetyStatus'], number> = {
  safe:    1.0,
  caution: 0.5,
  unsafe:  0.0,
};

/**
 * Recommender agent.
 * Ranks safety-checked products and returns the top N with availability notes.
 *
 * TODO: add an LLM call to generate a natural-language explanation for each
 * recommendation in the context of the user's original query.
 */
export async function recommenderAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { safetyCheckedProducts, userProfile } = state;

  const ranked = rank(safetyCheckedProducts);
  const top    = ranked.slice(0, MAX_RECOMMENDATIONS).map(p => ({
    ...p,
    availabilityNotes: buildAvailabilityNote(p, userProfile.country),
  }));

  return {
    finalRecommendations: top,
    currentStep: 'done',
  };
}

function rank(products: RecommendedProduct[]): RecommendedProduct[] {
  return [...products].sort((a, b) => {
    const scoreA = SAFETY_WEIGHT[a.safetyStatus] * 0.6 + a.relevanceScore * 0.4;
    const scoreB = SAFETY_WEIGHT[b.safetyStatus] * 0.6 + b.relevanceScore * 0.4;
    return scoreB - scoreA;
  });
}

function buildAvailabilityNote(product: RecommendedProduct, country?: string): string {
  if (!country) return '';
  if (product.countryAvailability.includes(country)) return `Available in ${country}.`;
  if (product.sourceUrl) return `Check availability: ${product.sourceUrl}`;
  return 'Availability unconfirmed — check local retailers.';
}
