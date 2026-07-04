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
      [ingredients, conditions],
    );
    return result.rows;
  } catch (err) {
    throw new RepositoryError('safetyRules', 'Failed to query safety violations', err);
  }
}
