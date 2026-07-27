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

  // ── Other food-derived allergens (cosmetic INCI equivalents) ───────────────
  { ingredient: 'arachis hypogaea oil',             contraindication: 'peanut_allergy',    severity: 'high',   notes: 'Peanut oil — avoid with peanut allergy.',                          source: 'Allergy guidelines' },
  { ingredient: 'hydrogenated peanut oil',          contraindication: 'peanut_allergy',    severity: 'high',   notes: 'Peanut-derived oil — avoid with peanut allergy.',                  source: 'Allergy guidelines' },
  { ingredient: 'glycine soja oil',                 contraindication: 'soy_allergy',       severity: 'medium', notes: 'Soybean oil — caution with soy allergy.',                          source: 'Allergy guidelines' },
  { ingredient: 'hydrolyzed soy protein',           contraindication: 'soy_allergy',       severity: 'high',   notes: 'Soy protein — avoid with soy allergy.',                            source: 'Allergy guidelines' },
  { ingredient: 'lac',                              contraindication: 'milk_allergy',      severity: 'medium', notes: 'Milk — caution with dairy/milk allergy.',                          source: 'Allergy guidelines' },
  { ingredient: 'sodium caseinate',                 contraindication: 'milk_allergy',      severity: 'medium', notes: 'Milk protein derivative — caution with dairy/milk allergy.',      source: 'Allergy guidelines' },
  { ingredient: 'ovum',                              contraindication: 'egg_allergy',       severity: 'medium', notes: 'Egg extract — caution with egg allergy.',                          source: 'Allergy guidelines' },
  { ingredient: 'triticum vulgare germ oil',        contraindication: 'wheat_allergy',      severity: 'medium', notes: 'Wheat germ oil — caution with wheat/gluten allergy.',             source: 'Allergy guidelines' },
  { ingredient: 'hydrolyzed wheat protein',         contraindication: 'wheat_allergy',      severity: 'high',   notes: 'Wheat protein — avoid with wheat/gluten allergy.',                source: 'Allergy guidelines' },
  { ingredient: 'sesamum indicum seed oil',         contraindication: 'sesame_allergy',     severity: 'high',   notes: 'Sesame oil — avoid with sesame allergy.',                          source: 'Allergy guidelines' },
  { ingredient: 'chitosan',                          contraindication: 'shellfish_allergy', severity: 'medium', notes: 'Crustacean shell-derived — caution with shellfish allergy.',       source: 'Allergy guidelines' },

  // ── Fragrance allergens ─────────────────────────────────────────────────────
  { ingredient: 'fragrance', contraindication: 'fragrance_sensitivity', severity: 'medium', notes: 'Top cause of cosmetic contact dermatitis.',          source: 'SCCS' },
  { ingredient: 'parfum',    contraindication: 'fragrance_sensitivity', severity: 'medium', notes: 'Fragrance blend — avoid with fragrance sensitivity.', source: 'SCCS' },
  { ingredient: 'linalool',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'Oxidised linalool is a sensitiser.',                  source: 'SCCS' },
  { ingredient: 'limonene',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'Oxidised limonene is a sensitiser.',                  source: 'SCCS' },
  { ingredient: 'citral',    contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'geraniol',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'coumarin',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'd limonene', contraindication: 'fragrance_sensitivity', severity: 'low',   notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'eugenol',   contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'isoeugenol', contraindication: 'fragrance_sensitivity', severity: 'low',   notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'farnesol',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'citronellol', contraindication: 'fragrance_sensitivity', severity: 'low',  notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'cinnamal',  contraindication: 'fragrance_sensitivity', severity: 'low',    notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'cinnamyl alcohol', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'benzyl alcohol', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'benzyl benzoate', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'benzyl salicylate', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'benzyl cinnamate', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'hexyl cinnamal', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'hydroxycitronellal', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'amyl cinnamal', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'anise alcohol', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen (anisyl alcohol) — requires labelling.', source: 'SCCS' },
  { ingredient: 'alpha isomethyl ionone', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'EU-listed fragrance allergen — requires labelling.', source: 'SCCS' },
  { ingredient: 'evernia prunastri extract', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'Oakmoss extract — EU-listed fragrance allergen.', source: 'SCCS' },
  { ingredient: 'hydroxyisohexyl 3 cyclohexene carboxaldehyde', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'HICC/Lyral — EU-listed fragrance allergen.', source: 'SCCS' },
  { ingredient: 'butylphenyl methylpropional', contraindication: 'fragrance_sensitivity', severity: 'low', notes: 'Lilial — EU-listed fragrance allergen, restricted in leave-on products.', source: 'SCCS' },

  // ── Food-derived allergens declared via OBF allergens_tags (matches allergyNormalizer.ts categories) ──
  { ingredient: 'nuts',     contraindication: 'nut_allergy',       severity: 'high',   notes: 'Declared nut-derived ingredient — avoid with tree nut allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'peanuts',  contraindication: 'peanut_allergy',    severity: 'high',   notes: 'Declared peanut-derived ingredient — avoid with peanut allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'milk',     contraindication: 'milk_allergy',      severity: 'medium', notes: 'Declared milk-derived ingredient — caution with dairy/milk allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'eggs',     contraindication: 'egg_allergy',       severity: 'medium', notes: 'Declared egg-derived ingredient — caution with egg allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'wheat',    contraindication: 'wheat_allergy',     severity: 'medium', notes: 'Declared wheat-derived ingredient — caution with wheat/gluten allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'gluten',   contraindication: 'wheat_allergy',     severity: 'medium', notes: 'Declared gluten-containing ingredient — caution with wheat/gluten allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'sesame seeds', contraindication: 'sesame_allergy', severity: 'high',  notes: 'Declared sesame-derived ingredient — avoid with sesame allergy.', source: 'OBF allergens_tags' },
  { ingredient: 'soybeans', contraindication: 'soy_allergy',       severity: 'medium', notes: 'Declared soy-derived ingredient — caution with soy allergy.', source: 'OBF allergens_tags' },

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
