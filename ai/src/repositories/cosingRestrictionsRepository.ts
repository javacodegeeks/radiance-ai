import { getDb } from '../infra/db';
import { CosingProhibitedSubstance, CosingRestriction } from '../types';
import { RepositoryError } from '../common/errors';

interface CosingRestrictionRow {
  id: string;
  ingredient: string;
  annex: string;
  reference_number: string;
  restriction_scope: string | null;
  max_concentration: string | null;
  conditions_text: string | null;
  regulation: string | null;
}

interface CosingProhibitedRow {
  id: string;
  ingredient: string;
  reference_number: string;
  regulation: string | null;
  cmr: string | null;
}

function toRestriction(row: CosingRestrictionRow): CosingRestriction {
  return {
    id: row.id,
    ingredient: row.ingredient,
    annex: row.annex,
    referenceNumber: row.reference_number,
    restrictionScope: row.restriction_scope ?? undefined,
    maxConcentration: row.max_concentration ?? undefined,
    conditionsText: row.conditions_text ?? undefined,
    regulation: row.regulation ?? undefined,
  };
}

function toProhibited(row: CosingProhibitedRow): CosingProhibitedSubstance {
  return {
    id: row.id,
    ingredient: row.ingredient,
    referenceNumber: row.reference_number,
    regulation: row.regulation ?? undefined,
    cmr: row.cmr ?? undefined,
  };
}

/**
 * EU-regulated (CosIng Annex III/IV/V) restrictions matching any of the given
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
      `SELECT id, ingredient, annex, reference_number, restriction_scope, max_concentration, conditions_text, regulation
       FROM cosing_restrictions
       WHERE ingredient = ANY($1::text[])`,
      [normalizedIngredients],
    );
    return result.rows.map(toRestriction);
  } catch (err) {
    throw new RepositoryError('cosingRestrictions', 'Failed to query CosIng restrictions', err);
  }
}

/**
 * EU CosIng Annex II substances (prohibited outright in cosmetic products)
 * matching any of the given ingredients. A stronger signal than Annex
 * III/IV/V restrictions — callers should treat a match here as unsafe.
 */
export async function findProhibitedSubstances(ingredients: string[]): Promise<CosingProhibitedSubstance[]> {
  if (!ingredients.length) return [];

  const normalizedIngredients = ingredients.map(i => i.trim().toLowerCase());

  const pool = getDb();
  try {
    const result = await pool.query<CosingProhibitedRow>(
      `SELECT id, ingredient, reference_number, regulation, cmr
       FROM cosing_prohibited_substances
       WHERE ingredient = ANY($1::text[])`,
      [normalizedIngredients],
    );
    return result.rows.map(toProhibited);
  } catch (err) {
    throw new RepositoryError('cosingProhibitedSubstances', 'Failed to query CosIng prohibited substances', err);
  }
}
