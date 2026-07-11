/**
 * Allergy normalizer.
 *
 * Maps free-text allergy mentions (as typed by the user, or extracted by the
 * Questioner LLM) to the fixed contraindication tags used in the `safety_rules`
 * table (see data/pipeline/02-seed-safety.ts). Without this, findSafetyViolations'
 * exact-match lookup against `contraindication` never fires for real user input.
 *
 * Unrecognised terms are passed through unchanged (lowercased) so they're still
 * visible to the user/profile, even though they won't match any safety rule.
 */

const ALLERGY_ALIAS_TO_TAG: Record<string, string> = {
  // nut_allergy (tree nuts)
  nut: 'nut_allergy', nuts: 'nut_allergy', 'tree nut': 'nut_allergy', 'tree nuts': 'nut_allergy',
  'nut allergy': 'nut_allergy', 'tree nut allergy': 'nut_allergy',
  almond: 'nut_allergy', almonds: 'nut_allergy', macadamia: 'nut_allergy',
  hazelnut: 'nut_allergy', hazelnuts: 'nut_allergy', walnut: 'nut_allergy', walnuts: 'nut_allergy',
  cashew: 'nut_allergy', cashews: 'nut_allergy',

  // peanut_allergy
  peanut: 'peanut_allergy', peanuts: 'peanut_allergy', groundnut: 'peanut_allergy', groundnuts: 'peanut_allergy',
  'peanut allergy': 'peanut_allergy',

  // soy_allergy
  soy: 'soy_allergy', soya: 'soy_allergy', soybean: 'soy_allergy', soybeans: 'soy_allergy',
  'soy allergy': 'soy_allergy',

  // milk_allergy
  milk: 'milk_allergy', dairy: 'milk_allergy', 'milk allergy': 'milk_allergy', 'dairy allergy': 'milk_allergy',

  // egg_allergy
  egg: 'egg_allergy', eggs: 'egg_allergy', 'egg allergy': 'egg_allergy',

  // wheat_allergy
  wheat: 'wheat_allergy', gluten: 'wheat_allergy', 'wheat allergy': 'wheat_allergy', 'gluten allergy': 'wheat_allergy',

  // sesame_allergy
  sesame: 'sesame_allergy', 'sesame seed': 'sesame_allergy', 'sesame allergy': 'sesame_allergy',

  // shellfish_allergy
  shellfish: 'shellfish_allergy', shrimp: 'shellfish_allergy', shrimps: 'shellfish_allergy',
  prawn: 'shellfish_allergy', prawns: 'shellfish_allergy', crab: 'shellfish_allergy', lobster: 'shellfish_allergy',
  'shellfish allergy': 'shellfish_allergy',

  // fragrance_sensitivity
  fragrance: 'fragrance_sensitivity', perfume: 'fragrance_sensitivity', parfum: 'fragrance_sensitivity',
  scent: 'fragrance_sensitivity', scented: 'fragrance_sensitivity', 'fragrance sensitivity': 'fragrance_sensitivity',

  // preservative_sensitivity
  preservative: 'preservative_sensitivity', preservatives: 'preservative_sensitivity',
  mi: 'preservative_sensitivity', mci: 'preservative_sensitivity',
  methylisothiazolinone: 'preservative_sensitivity', methylchloroisothiazolinone: 'preservative_sensitivity',
  'preservative sensitivity': 'preservative_sensitivity',

  // aspirin_allergy
  aspirin: 'aspirin_allergy', salicylate: 'aspirin_allergy', salicylates: 'aspirin_allergy',
  'aspirin allergy': 'aspirin_allergy',
};

function normalizeForLookup(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Normalize a list (or comma-separated string) of free-text allergy mentions
 * to the fixed contraindication tags used in `safety_rules`. Terms with no
 * known mapping are kept as-is (lowercased) rather than dropped.
 */
export function normalizeAllergies(allergies: string | string[] | null | undefined): string[] {
  if (!allergies) return [];

  const entries = (typeof allergies === 'string' ? allergies.split(',') : allergies)
    .map(entry => String(entry).trim())
    .filter(Boolean);

  return entries.map(entry => {
    const key = normalizeForLookup(entry);
    return ALLERGY_ALIAS_TO_TAG[key] ?? key;
  });
}
