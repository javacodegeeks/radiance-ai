import { Pool } from 'pg';
import { getDb } from '../db';

export interface SafetyRuleRow {
  id: string;
  ingredient: string;
  contraindication: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  source?: string;
}

export class SafetyRulesRepository {
  private db: Pool;

  constructor(db?: Pool) {
    this.db = db ?? getDb();
  }

  async findViolations(ingredients: string[], conditions: string[]): Promise<SafetyRuleRow[]> {
    if (!ingredients.length || !conditions.length) return [];

    const result = await this.db.query<SafetyRuleRow>(
      `SELECT id, ingredient, contraindication, severity, notes, source
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
  }

  async upsertRule(rule: Omit<SafetyRuleRow, 'id'>): Promise<SafetyRuleRow> {
    const result = await this.db.query<SafetyRuleRow>(
      `INSERT INTO safety_rules (ingredient, contraindication, severity, notes, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ingredient, contraindication) DO UPDATE SET
         severity   = EXCLUDED.severity,
         notes      = EXCLUDED.notes,
         source     = EXCLUDED.source,
         updated_at = NOW()
       RETURNING id, ingredient, contraindication, severity, notes, source`,
      [rule.ingredient, rule.contraindication, rule.severity, rule.notes ?? null, rule.source ?? null],
    );
    return result.rows[0];
  }

  async getAllRules(): Promise<SafetyRuleRow[]> {
    const result = await this.db.query<SafetyRuleRow>(
      'SELECT id, ingredient, contraindication, severity, notes, source FROM safety_rules ORDER BY ingredient, contraindication',
    );
    return result.rows;
  }
}
