import { SafetyRule } from '../types';

/**
 * Looks up safety rule violations for a given set of ingredients and user conditions.
 *
 * In production this queries the data-layer SafetyRulesRepository.
 * During testing, inject a mock via the `setRulesProvider` hook below.
 */
export type RulesProvider = (
  ingredients: string[],
  conditions:  string[],
) => Promise<SafetyRule[]>;

let _provider: RulesProvider = async () => {
  throw new Error(
    'safetyRulesLookup: no provider configured. ' +
    'Call setRulesProvider() with a SafetyRulesRepository instance before using agents.',
  );
};

export function setRulesProvider(fn: RulesProvider): void {
  _provider = fn;
}

export async function getSafetyRulesForIngredients(
  ingredients: string[],
  conditions:  string[],
): Promise<SafetyRule[]> {
  if (!ingredients.length || !conditions.length) return [];
  return _provider(ingredients, conditions);
}
