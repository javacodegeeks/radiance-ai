import { getDb } from '../infra/db';
import { CosingRestriction } from '../types';
import { RepositoryError } from '../common/errors';

interface CosingRestrictionRow {
  id: string;
  ingredient: string;
  reference_number: string;
  restriction_scope: string | null;
  max_concentration: string | null;
  conditions_text: string | null;
  regulation: string | null;
}

function toRestriction(row: CosingRestrictionRow): CosingRestriction {
  return {
    id: row.id,
    ingredient: row.ingredient,
    referenceNumber: row.reference_number,
    restrictionScope: row.restriction_scope ?? undefined,
    maxConcentration: row.max_concentration ?? undefined,
    conditionsText: row.conditions_text ?? undefined,
    regulation: row.regulation ?? undefined,
  };
}

/**
 * EU-regulated (CosIng Annex III) restrictions matching any of the given
 * ingredients. Unlike safety_rules, this is not user-condition-specific —
 * these are usage-concentration/warning restrictions that apply regardless
 * of who's using the product, so callers surface them as a general caution.
 */
export async function findCosingRestrictions(ingredients: string[]): Promise<CosingRestriction[]> {
  if (!ingredients.length) return [];

  const normalizedIngredients = ingredients.map(i => i.trim().toLowerCase());

  const pool = getDb();
  try {
    const result = await pool.query<CosingRestrictionRow>(
      `SELECT id, ingredient, reference_number, restriction_scope, max_concentration, conditions_text, regulation
       FROM cosing_restrictions
       WHERE ingredient = ANY($1::text[])`,
      [normalizedIngredients],
    );
    return result.rows.map(toRestriction);
  } catch (err) {
    throw new RepositoryError('cosingRestrictions', 'Failed to query CosIng restrictions', err);
  }
}
