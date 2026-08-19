import { getDb } from '../infra/db';
import { RepositoryError } from '../common/errors';

/**
 * Closed glossary of EU CosIng ingredient functions (~83 entries) loaded by
 * data/pipeline/09-load-cosing-functions.ts / data/migrations/007_cosing_functions.sql
 * (cosing_function.function_name). Exported so llm/prompts.ts can list real
 * values for the LLM's `counteractingFunction` output, and agents/recommender.ts
 * can validate that output against this exact list at runtime (see
 * COSING_FUNCTION_SET in recommender.ts — deliberately not a zod enum, so an
 * unrecognized value skips just that one risk instead of failing the whole
 * recommendation parse) before querying findIngredientsByFunction below, so
 * no fuzzy/ILIKE matching is needed on the query itself.
 *
 * This is a different, finer-grained axis from Product.category
 * ('cleanser'|'treatment'|'moisturizer'|'spf'|'exfoliant', see
 * data/pipeline/08-classify-categories.ts): these ~83 tags describe what an
 * *ingredient* does (e.g. MOISTURISING, EXFOLIATING), not what routine step a
 * *product* belongs to. Nothing here computes or replaces Product.category —
 * it's only used narrowly to find real ingredients/products that counteract a
 * specific side-effect risk. 08-classify-categories.ts remains the source of
 * truth for AM/PM routine sequencing.
 */
export const COSING_FUNCTION_NAMES = [
  'ABRASIVE', 'ABSORBENT', 'ADHESIVE', 'ANTI-SEBORRHEIC', 'ANTI-SEBUM', 'ANTICAKING',
  'ANTICORROSIVE', 'ANTIFOAMING', 'ANTIMICROBIAL', 'ANTIOXIDANT', 'ANTIPERSPIRANT',
  'ANTIPLAQUE', 'ANTISTATIC', 'ASTRINGENT', 'BINDING', 'BLEACHING', 'BUFFERING',
  'BULKING', 'CHELATING', 'CLEANSING', 'COLORANT', 'DENATURANT', 'DEODORANT',
  'DEPILATORY', 'DETANGLING', 'DISPERSING NON-SURFACTANT', 'EMULSION STABILISING',
  'EPILATING', 'EXFOLIATING', 'EYELASH CONDITIONING', 'FILM FORMING', 'FLAVOURING',
  'FOAMING', 'FRAGRANCE', 'GEL FORMING', 'HAIR CONDITIONING', 'HAIR DYEING',
  'HAIR FIXING', 'HAIR WAVING OR STRAIGHTENING', 'HUMECTANT', 'KERATOLYTIC',
  'LIGHT STABILIZER', 'LYTIC', 'MOISTURISING', 'NAIL CONDITIONING', 'NAIL SCULPTING',
  'NOT REPORTED', 'OCCLUSIVE', 'OPACIFYING', 'ORAL CARE', 'OXIDISING', 'PEARLESCENT',
  'PERFUMING', 'PLASTICISER', 'PRESERVATIVE', 'PROPELLANT', 'REDUCING', 'REFATTING',
  'REFRESHING', 'SKIN CONDITIONING', 'SKIN CONDITIONING - EMOLLIENT',
  'SKIN CONDITIONING - HUMECTANT', 'SKIN CONDITIONING - MISCELLANEOUS',
  'SKIN CONDITIONING - OCCLUSIVE', 'SKIN PROTECTING', 'SLIP MODIFIER', 'SMOOTHING',
  'SOLVENT', 'SOOTHING', 'SURFACE MODIFIER', 'SURFACTANT', 'SURFACTANT - CLEANSING',
  'SURFACTANT - DISPERSING', 'SURFACTANT - EMULSIFYING', 'SURFACTANT - FOAM BOOSTING',
  'SURFACTANT - HYDROTROPE', 'SURFACTANT - SOLUBILIZING', 'TANNING', 'TONIC',
  'UV ABSORBER', 'UV FILTER', 'VISCOSITY CONTROLLING', 'pH ADJUSTERS',
] as const;

interface IngredientByFunctionRow {
  inci_name: string;
}

/**
 * INCI ingredient names carrying any of the given EU CosIng functions (e.g.
 * "MOISTURISING", "SOOTHING") — used to find a real, catalog-grounded
 * complementary product that counteracts a specific side-effect risk (see
 * agents/recommender.ts resolveComplementaryProducts). Callers must pass
 * exact values from COSING_FUNCTION_NAMES above.
 */
export async function findIngredientsByFunction(functionNames: string[]): Promise<string[]> {
  if (!functionNames.length) return [];

  const pool = getDb();
  try {
    const result = await pool.query<IngredientByFunctionRow>(
      `SELECT DISTINCT i.inci_name
       FROM ingredient i
       JOIN ingredient_function ifn ON ifn.ingredient_substance_id = i.substance_id
       JOIN cosing_function cf ON cf.function_id = ifn.function_id
       WHERE cf.function_name = ANY($1::text[])`,
      [functionNames],
    );
    console.log(`[cosingFunctions] ${result.rows.length} ingredient(s) matched functions=[${functionNames.join(', ')}]`);
    return result.rows.map(r => r.inci_name);
  } catch (err) {
    console.error('[cosingFunctions] query failed', err);
    throw new RepositoryError('cosingFunctions', 'Failed to query CosIng functions', err);
  }
}
