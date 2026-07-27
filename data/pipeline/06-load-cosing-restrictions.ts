/**
 * Step 6 — Load EU CosIng "allowed with conditions" annexes into PostgreSQL:
 *   Annex III — restricted substances (concentration limits, warnings)
 *   Annex IV  — colorants allowed in cosmetic products
 *   Annex V   — preservatives allowed in cosmetic products
 *
 * All three share the same shape (see ANNEX_CONFIGS below for the exact
 * column layout of each, which differs slightly per annex). See
 * 07-load-cosing-prohibited.ts for Annex II (prohibited outright — a
 * different, simpler shape and a stronger safety signal).
 *
 * Source files: data/dataset/COSING_Annex_{III,IV,V}_v2.csv — official EU
 * exports, converted from the original .xls downloads to plain CSV (avoids
 * pulling in a legacy-binary Excel parser as a runtime dependency).
 *
 * These files are git-ignored (data/dataset/) and must be placed manually —
 * unlike the OBF dump (see src/infra/dataLoader.ts), CosIng has no confirmed
 * stable public download URL to auto-fetch them from (the public reference
 * pages are an Angular SPA backed by a credential-gated API). Export each
 * from the CosIng substance-search UI (as .xls) and convert to CSV before
 * dropping it at its path.
 *
 * One row per (substance, annex, reference number) — NOT one row per
 * "Identified INGREDIENTS or substances e.g." member. That column lists
 * examples of specific INCI names covered by the substance (e.g.
 * "Thioglycolic acid and its salts" covers SODIUM THIOGLYCOLATE, CALCIUM
 * THIOGLYCOLATE, etc.), but the concentration/scope/conditions on an annex
 * row apply to the *substance* as a whole, not individually to each member —
 * and the same member ingredient name can appear under multiple different
 * substances with different restrictions. Splitting by member and copying
 * the substance's restriction onto every member would misrepresent which
 * restriction applies to which name. The substance itself is identified by
 * "Name of Common Ingredients Glossary" (its own INCI name), falling back to
 * "Chemical name / INN" when the glossary name is blank.
 * Safe to re-run without duplicating data (upsert on ingredient + annex + reference_number).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb, closeDb } from '../src/infra/db';

const DATA_START_ROW = 8;

interface AnnexConfig {
  annex: string;
  file: string;
  columns: {
    referenceNumber: number;
    chemicalName: number;
    inciName: number;
    restrictionScope: number;
    maxConcentration: number;
    otherConditions: number;
    conditionsText: number;
    regulation: number;
    cmr: number;
  };
}

// Column indices differ slightly per annex — see each file's header row
// (rows 6-7) for the authoritative layout.
const ANNEX_CONFIGS: AnnexConfig[] = [
  {
    annex: 'III',
    file: 'COSING_Annex_III_v2.csv',
    columns: {
      referenceNumber: 0, chemicalName: 1, inciName: 2,
      restrictionScope: 5, maxConcentration: 6, otherConditions: 7,
      conditionsText: 8, regulation: 9, cmr: 14,
    },
  },
  {
    annex: 'IV',
    file: 'COSING_Annex_IV_v2.csv',
    columns: {
      referenceNumber: 0, chemicalName: 1, inciName: 2,
      restrictionScope: 6, maxConcentration: 7, otherConditions: 8,
      conditionsText: 9, regulation: 10, cmr: 15,
    },
  },
  {
    annex: 'V',
    file: 'COSING_Annex_V_v2.csv',
    columns: {
      referenceNumber: 0, chemicalName: 1, inciName: 2,
      restrictionScope: 5, maxConcentration: 6, otherConditions: 7,
      conditionsText: 8, regulation: 9, cmr: 14,
    },
  },
];

interface RestrictionRecord {
  ingredient: string;
  annex: string;
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

/** The substance's own name — INCI/Common Ingredients Glossary name, falling back to chemical name/INN. */
function extractSubstanceName(row: unknown[], columns: AnnexConfig['columns']): string | null {
  const inciName = cell(row, columns.inciName);
  if (inciName) return inciName;

  const chemicalName = cell(row, columns.chemicalName);
  return chemicalName || null;
}

function parseAnnex(config: AnnexConfig): RestrictionRecord[] {
  const sourceFile = path.join(__dirname, '..', 'dataset', config.file);
  const csvContent = fs.readFileSync(sourceFile, 'utf8');
  const rows: unknown[][] = parse(csvContent, { relax_column_count: true });

  const records: RestrictionRecord[] = [];
  const { columns } = config;

  for (const row of rows.slice(DATA_START_ROW)) {
    const referenceNumber = cell(row, columns.referenceNumber);
    if (!referenceNumber) continue; // trailing blank rows

    const ingredientName = extractSubstanceName(row, columns);
    if (!ingredientName) continue; // no identifiable substance name

    const restrictionScope = toNullable(cell(row, columns.restrictionScope));
    const maxConcentration = toNullable(
      [cell(row, columns.maxConcentration), cell(row, columns.otherConditions)].filter(Boolean).join(' | '),
    );
    const conditionsText = toNullable(cell(row, columns.conditionsText));
    const regulation = toNullable(cell(row, columns.regulation));
    const cmr = toNullable(cell(row, columns.cmr));

    records.push({
      ingredient: ingredientName.toLowerCase(),
      annex: config.annex,
      referenceNumber,
      restrictionScope,
      maxConcentration,
      conditionsText,
      regulation,
      cmr,
    });
  }

  return records;
}

export async function loadCosingRestrictions(): Promise<void> {
  const pool = getDb();

  for (const config of ANNEX_CONFIGS) {
    const records = parseAnnex(config);
    console.log(`  Parsed ${records.length} substance/restriction row(s) from Annex ${config.annex}...`);

    for (const r of records) {
      await pool.query(
        `INSERT INTO cosing_restrictions
           (ingredient, annex, reference_number, restriction_scope, max_concentration, conditions_text, regulation, cmr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ingredient, annex, reference_number) DO UPDATE SET
           restriction_scope = EXCLUDED.restriction_scope,
           max_concentration = EXCLUDED.max_concentration,
           conditions_text   = EXCLUDED.conditions_text,
           regulation        = EXCLUDED.regulation,
           cmr               = EXCLUDED.cmr,
           updated_at        = NOW()`,
        [r.ingredient, r.annex, r.referenceNumber, r.restrictionScope, r.maxConcentration, r.conditionsText, r.regulation, r.cmr],
      );
    }
  }
  console.log(`  Done.`);
}

if (require.main === module) {
  loadCosingRestrictions()
    .then(() => closeDb())
    .catch(err => { console.error('[06-load-cosing-restrictions] Failed:', err); process.exit(1); });
}
