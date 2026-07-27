import { getDb } from '../infra/db';
import { SafetyRule } from '../types';
import { RepositoryError } from '../common/errors';

interface SafetyRuleRow {
  id: string;
  ingredient: string;
  contraindication: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
}

export async function findSafetyViolations(
  ingredients: string[],
  conditions:  string[],
): Promise<SafetyRule[]> {
  if (!ingredients.length || !conditions.length) return [];

  // Seed data (data/pipeline/02-seed-safety.ts) stores both columns lowercase.
  // Callers pass through raw OBF ingredient text and LLM-extracted conditions,
  // neither of which is guaranteed to be lowercase — fold here once so every
  // caller gets a correct match regardless of casing upstream (e.g. raw
  // "D-Limonene" from a product's ingredient list vs. seeded "d limonene").
  const normalizedIngredients = ingredients.map(i => i.trim().toLowerCase());
  const normalizedConditions  = conditions.map(c => c.trim().toLowerCase());

  const pool = getDb();
  try {
    const result = await pool.query<SafetyRuleRow>(
      `SELECT id, ingredient, contraindication, severity, notes
       FROM safety_rules
       WHERE ingredient       = ANY($1::text[])
         AND contraindication = ANY($2::text[])
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           ELSE                 4
         END`,
      [normalizedIngredients, normalizedConditions],
    );
    console.log(`[safetyRules] ${result.rows.length} violation(s) for conditions=[${normalizedConditions.join(', ')}]`);
    return result.rows;
  } catch (err) {
    throw new RepositoryError('safetyRules', 'Failed to query safety violations', err);
  }
}

// ─── Known contraindication vocabulary ─────────────────────────────────────────

let cachedTags: { tags: Set<string>; expiresAt: number } | null = null;
const KNOWN_TAGS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Full set of contraindication tags currently present in safety_rules.
 * Lets callers distinguish "checked against a known category and cleared"
 * from "the user reported something we have no rules for at all" — the
 * latter must not be silently treated as a clean bill of health. Cached
 * briefly since this vocabulary only grows via the seed/ingestion pipeline,
 * not at request time.
 */
export async function getKnownContraindications(): Promise<Set<string>> {
  if (cachedTags && cachedTags.expiresAt > Date.now()) {
    return cachedTags.tags;
  }

  const pool = getDb();
  try {
    const result = await pool.query<{ contraindication: string }>(
      'SELECT DISTINCT contraindication FROM safety_rules',
    );
    const tags = new Set(result.rows.map(r => r.contraindication));
    cachedTags = { tags, expiresAt: Date.now() + KNOWN_TAGS_CACHE_TTL_MS };
    return tags;
  } catch (err) {
    throw new RepositoryError('safetyRules', 'Failed to load known contraindication tags', err);
  }
}
