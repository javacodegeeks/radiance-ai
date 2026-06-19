import { SafetyRulesRepository } from '../src/repositories/safetyRulesRepository';
import { closeDb } from '../src/db';
import { runMigrations } from '../src/migrate';

const INITIAL_RULES = [
  // ── Retinoids (teratogenic) ─────────────────────────────────────────────────
  { ingredient: 'retinol',          contraindication: 'pregnancy', severity: 'critical' as const, notes: 'Retinoids are teratogenic — avoid throughout pregnancy.', source: 'FDA/EMA guidelines' },
  { ingredient: 'retinyl palmitate', contraindication: 'pregnancy', severity: 'critical' as const, notes: 'Vitamin A derivative — contraindicated in pregnancy.', source: 'FDA/EMA guidelines' },
  { ingredient: 'tretinoin',        contraindication: 'pregnancy', severity: 'critical' as const, notes: 'Prescription retinoid — strictly contraindicated.', source: 'FDA/EMA guidelines' },

  // ── Salicylic acid ──────────────────────────────────────────────────────────
  { ingredient: 'salicylic acid', contraindication: 'pregnancy',     severity: 'high'     as const, notes: 'High-concentration use not recommended in pregnancy.', source: 'Dermatology guidelines' },
  { ingredient: 'salicylic acid', contraindication: 'aspirin_allergy', severity: 'high'   as const, notes: 'Salicylates may cross-react with aspirin sensitivity.', source: 'Clinical pharmacology' },

  // ── Nut-derived oils ────────────────────────────────────────────────────────
  { ingredient: 'prunus amygdalus dulcis oil',    contraindication: 'nut_allergy', severity: 'critical' as const, notes: 'Sweet almond oil — avoid with tree nut allergies.', source: 'Allergy guidelines' },
  { ingredient: 'macadamia integrifolia seed oil', contraindication: 'nut_allergy', severity: 'high'    as const, notes: 'Macadamia nut oil — caution with tree nut allergies.', source: 'Allergy guidelines' },

  // ── Fragrance allergens ─────────────────────────────────────────────────────
  { ingredient: 'fragrance',  contraindication: 'fragrance_sensitivity', severity: 'medium' as const, notes: 'Top cause of cosmetic contact dermatitis.', source: 'SCCS' },
  { ingredient: 'parfum',     contraindication: 'fragrance_sensitivity', severity: 'medium' as const, notes: 'Fragrance blend — avoid with fragrance sensitivity.', source: 'SCCS' },
  { ingredient: 'linalool',   contraindication: 'fragrance_sensitivity', severity: 'low'    as const, notes: 'Oxidised linalool is a sensitiser.', source: 'SCCS' },
  { ingredient: 'limonene',   contraindication: 'fragrance_sensitivity', severity: 'low'    as const, notes: 'Oxidised limonene is a sensitiser.', source: 'SCCS' },

  // ── Preservatives ───────────────────────────────────────────────────────────
  { ingredient: 'methylisothiazolinone',      contraindication: 'preservative_sensitivity', severity: 'high' as const, notes: 'MI is a potent sensitiser — restricted in EU leave-on products.', source: 'EU Cosmetics Regulation' },
  { ingredient: 'methylchloroisothiazolinone', contraindication: 'preservative_sensitivity', severity: 'high' as const, notes: 'MCI banned in leave-on products (EU).', source: 'EU Cosmetics Regulation' },

  // ── Alcohol ─────────────────────────────────────────────────────────────────
  { ingredient: 'alcohol denat.', contraindication: 'rosacea', severity: 'medium' as const, notes: 'Denatured alcohol can aggravate rosacea.', source: 'Dermatology guidelines' },
];

async function seed(): Promise<void> {
  await runMigrations();
  const repo = new SafetyRulesRepository();
  console.log(`Seeding ${INITIAL_RULES.length} safety rules...`);

  for (const rule of INITIAL_RULES) {
    await repo.upsertRule(rule);
    console.log(`  ✓  ${rule.ingredient.padEnd(40)} → ${rule.contraindication} (${rule.severity})`);
  }

  console.log('\nSafety rules seeded successfully.');
  await closeDb();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
