/**
 * Step 2 — Seed ingredient safety rules into PostgreSQL.
 * Uses upsert — safe to re-run without duplicating data.
 * Requires step 01 (migrations) to have run first.
 */
import { getDb, closeDb } from '../src/infra/db';

const SAFETY_RULES = [
  // ── Retinoids (teratogenic) ─────────────────────────────────────────────────
  { ingredient: 'retinol',           contraindication: 'pregnancy', severity: 'critical', notes: 'Retinoids are teratogenic — avoid throughout pregnancy.',     source: 'FDA/EMA guidelines' },
  { ingredient: 'retinyl palmitate', contraindication: 'pregnancy', severity: 'critical', notes: 'Vitamin A derivative — contraindicated in pregnancy.',        source: 'FDA/EMA guidelines' },
  { ingredient: 'tretinoin',         contraindication: 'pregnancy', severity: 'critical', notes: 'Prescription retinoid — strictly contraindicated.',           source: 'FDA/EMA guidelines' },

  // ── Salicylic acid ──────────────────────────────────────────────────────────
  { ingredient: 'salicylic acid', contraindication: 'pregnancy',       severity: 'high', notes: 'High-concentration use not recommended in pregnancy.',    source: 'Dermatology guidelines' },
  { ingredient: 'salicylic acid', contraindication: 'aspirin_allergy', severity: 'high', notes: 'Salicylates may cross-react with aspirin sensitivity.',   source: 'Clinical pharmacology' },

  // ── Nut-derived oils ────────────────────────────────────────────────────────
  { ingredient: 'prunus amygdalus dulcis oil',     contraindication: 'nut_allergy', severity: 'critical', notes: 'Sweet almond oil — avoid with tree nut allergies.',    source: 'Allergy guidelines' },
  { ingredient: 'macadamia integrifolia seed oil', contraindication: 'nut_allergy', severity: 'high',     notes: 'Macadamia nut oil — caution with tree nut allergies.', source: 'Allergy guidelines' },

  // ── Fragrance allergens ─────────────────────────────────────────────────────
  { ingredient: 'fragrance', contraindication: 'fragrance_sensitivity', severity: 'medium', notes: 'Top cause of cosmetic contact dermatitis.',          source: 'SCCS' },
  { ingredient: 'parfum',    contraindication: 'fragrance_sensitivity', severity: 'medium', notes: 'Fragrance blend — avoid with fragrance sensitivity.', source: 'SCCS' },
  { ingredient: 'linalool',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'Oxidised linalool is a sensitiser.',                  source: 'SCCS' },
  { ingredient: 'limonene',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'Oxidised limonene is a sensitiser.',                  source: 'SCCS' },

  // ── Preservatives ───────────────────────────────────────────────────────────
  { ingredient: 'methylisothiazolinone',       contraindication: 'preservative_sensitivity', severity: 'high', notes: 'MI is a potent sensitiser — restricted in EU leave-on products.', source: 'EU Cosmetics Regulation' },
  { ingredient: 'methylchloroisothiazolinone', contraindication: 'preservative_sensitivity', severity: 'high', notes: 'MCI banned in leave-on products (EU).',                          source: 'EU Cosmetics Regulation' },

  // ── Alcohol ─────────────────────────────────────────────────────────────────
  { ingredient: 'alcohol denat.', contraindication: 'rosacea', severity: 'medium', notes: 'Denatured alcohol can aggravate rosacea.', source: 'Dermatology guidelines' },
];

export async function seedSafetyRules(): Promise<void> {
  const pool = getDb();
  console.log(`  Seeding ${SAFETY_RULES.length} safety rules...`);
  for (const rule of SAFETY_RULES) {
    await pool.query(
      `INSERT INTO safety_rules (ingredient, contraindication, severity, notes, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ingredient, contraindication) DO UPDATE SET
         severity   = EXCLUDED.severity,
         notes      = EXCLUDED.notes,
         source     = EXCLUDED.source,
         updated_at = NOW()`,
      [rule.ingredient, rule.contraindication, rule.severity, rule.notes, rule.source],
    );
    console.log(`    ✓  ${rule.ingredient.padEnd(40)} → ${rule.contraindication} (${rule.severity})`);
  }
  console.log(`  Done.`);
}

if (require.main === module) {
  seedSafetyRules()
    .then(() => closeDb())
    .catch(err => { console.error('[02-seed-safety] Failed:', err); process.exit(1); });
}
