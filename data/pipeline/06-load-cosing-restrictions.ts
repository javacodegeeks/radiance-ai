/**
 * Step 6 — Load EU CosIng Annex III (restricted substances) into PostgreSQL.
 *
 * Source file: data/dataset/COSING_Annex_III_v2.csv — the official EU
 * "List of substances which cosmetic products must not contain except
 * subject to the restrictions laid down" export, converted from the
 * original .xls download to plain CSV (avoids pulling in a legacy-binary
 * Excel parser as a runtime dependency).
 *
 * This file is git-ignored (data/dataset/) and must be placed manually —
 * unlike the OBF dump (see src/infra/dataLoader.ts), CosIng has no confirmed
 * stable public download URL to auto-fetch it from (the public reference
 * pages are an Angular SPA backed by a credential-gated API; see PR
 * description for details). Export it from the CosIng substance-search UI
 * (as .xls) and convert to CSV before dropping it at this path.
 *
 * Data rows start at row index 8 (rows 0-7 are title/blank/header rows).
 * Columns (0-indexed):
 *   0  Reference Number
 *   1  Chemical name / INN
 *   2  Name of Common Ingredients Glossary (INCI name)
 *   3  CAS Number
 *   4  EC Number
 *   5  Product Type, body parts (restriction scope)
 *   6  Maximum concentration in ready for use preparation
 *   7  Other (restriction conditions, e.g. pH range)
 *   8  Wording of conditions of use and warnings
 *   9  Regulation
 *  10  Other Directives/Regulations
 *  11  SCCS opinions
 *  12  Chemical/IUPAC Name
 *  13  Identified INGREDIENTS or substances e.g. (newline-separated INCI names)
 *  14  CMR
 *  15  Update date
 *
 * Each Annex III entry lists several specific INCI name variants — every
 * variant becomes its own row (upserted), sharing the same restriction
 * metadata, so lookups can match directly against a product's INCI list
 * the same way safety_rules does.
 * Safe to re-run without duplicating data (upsert on ingredient + reference_number).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb, closeDb } from '../src/infra/db';

const SOURCE_FILE = path.join(__dirname, '..', 'dataset', 'COSING_Annex_III_v2.csv');
const DATA_START_ROW = 8;

const COL = {
  REFERENCE_NUMBER: 0,
  CHEMICAL_NAME: 1,
  INCI_NAME: 2,
  RESTRICTION_SCOPE: 5,
  MAX_CONCENTRATION: 6,
  OTHER_CONDITIONS: 7,
  CONDITIONS_TEXT: 8,
  REGULATION: 9,
  IDENTIFIED_INGREDIENTS: 13,
  CMR: 14,
} as const;

interface RestrictionRecord {
  ingredient: string;
  referenceNumber: string;
  restrictionScope: string | null;
  maxConcentration: string | null;
  conditionsText: string | null;
  regulation: string | null;
  cmr: string | null;
}

function cell(row: unknown[], index: number): string {
  const value = row[index];
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function toNullable(value: string): string | null {
  return value.length > 0 ? value : null;
}

/** Every distinct ingredient-name variant an Annex III row identifies. */
function extractIngredientNames(row: unknown[]): string[] {
  const names = new Set<string>();

  const inciName = cell(row, COL.INCI_NAME);
  if (inciName) names.add(inciName);

  const identified = cell(row, COL.IDENTIFIED_INGREDIENTS);
  for (const line of identified.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) names.add(trimmed);
  }

  // Fall back to the chemical/INN name only if neither of the above yielded
  // anything — it's a description rather than a strict INCI name, but it's
  // better than losing the entry entirely.
  if (names.size === 0) {
    const chemicalName = cell(row, COL.CHEMICAL_NAME);
    if (chemicalName) names.add(chemicalName);
  }

  return Array.from(names);
}

function parseRows(): RestrictionRecord[] {
  const csvContent = fs.readFileSync(SOURCE_FILE, 'utf8');
  const rows: unknown[][] = parse(csvContent, { relax_column_count: true });

  const records: RestrictionRecord[] = [];

  for (const row of rows.slice(DATA_START_ROW)) {
    const referenceNumber = cell(row, COL.REFERENCE_NUMBER);
    if (!referenceNumber) continue; // trailing blank rows

    const restrictionScope = toNullable(cell(row, COL.RESTRICTION_SCOPE));
    const maxConcentration = toNullable(
      [cell(row, COL.MAX_CONCENTRATION), cell(row, COL.OTHER_CONDITIONS)].filter(Boolean).join(' | '),
    );
    const conditionsText = toNullable(cell(row, COL.CONDITIONS_TEXT));
    const regulation = toNullable(cell(row, COL.REGULATION));
    const cmr = toNullable(cell(row, COL.CMR));

    for (const name of extractIngredientNames(row)) {
      records.push({
        ingredient: name.toLowerCase(),
        referenceNumber,
        restrictionScope,
        maxConcentration,
        conditionsText,
        regulation,
        cmr,
      });
    }
  }

  return records;
}

export async function loadCosingRestrictions(): Promise<void> {
  const records = parseRows();
  console.log(`  Parsed ${records.length} ingredient/restriction row(s) from Annex III...`);

  const pool = getDb();
  for (const r of records) {
    await pool.query(
      `INSERT INTO cosing_restrictions
         (ingredient, reference_number, restriction_scope, max_concentration, conditions_text, regulation, cmr)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ingredient, reference_number) DO UPDATE SET
         restriction_scope = EXCLUDED.restriction_scope,
         max_concentration = EXCLUDED.max_concentration,
         conditions_text   = EXCLUDED.conditions_text,
         regulation        = EXCLUDED.regulation,
         cmr               = EXCLUDED.cmr,
         updated_at         = NOW()`,
      [r.ingredient, r.referenceNumber, r.restrictionScope, r.maxConcentration, r.conditionsText, r.regulation, r.cmr],
    );
  }
  console.log(`  Done.`);
}

if (require.main === module) {
  loadCosingRestrictions()
    .then(() => closeDb())
    .catch(err => { console.error('[06-load-cosing-restrictions] Failed:', err); process.exit(1); });
}
