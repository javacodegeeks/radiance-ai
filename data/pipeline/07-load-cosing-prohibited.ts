/**
 * Step 7 — Load EU CosIng Annex II (substances prohibited outright in
 * cosmetic products) into PostgreSQL.
 *
 * Source file: data/dataset/COSING_Annex_II_v2.csv — official EU export,
 * converted from the original .xls download to plain CSV (see
 * 06-load-cosing-restrictions.ts for why).
 *
 * Simpler shape than Annex III/IV/V — no concentration/usage-condition
 * columns, since these substances aren't permitted under any condition.
 * Columns (0-indexed), data rows starting at row index 8:
 *   0 Reference Number
 *   1 Chemical name / INN
 *   2 CAS Number
 *   3 EC Number
 *   4 Regulation
 *   5 Other Directives/Regulations
 *   6 SCCS opinions
 *   7 Chemical/IUPAC Name
 *   8 Identified INGREDIENTS or substances e.g. (newline-separated INCI names)
 *   9 CMR
 *  10 Update date
 *
 * One row per (substance, reference number) — identified by "Chemical name /
 * INN" (Annex II has no separate INCI/Common Ingredients Glossary column).
 * The "Identified INGREDIENTS or substances e.g." column (8) lists example
 * member INCI names covered by the substance; it is not used to key rows —
 * see 06-load-cosing-restrictions.ts's header comment for why splitting by
 * that column and copying the substance's data onto every member would be
 * incorrect (a member ingredient can belong to multiple substances).
 * Safe to re-run without duplicating data (upsert on ingredient + reference_number).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb, closeDb } from '../src/infra/db';

const SOURCE_FILE = path.join(__dirname, '..', 'dataset', 'COSING_Annex_II_v2.csv');
const DATA_START_ROW = 8;

const COL = {
  REFERENCE_NUMBER: 0,
  CHEMICAL_NAME: 1,
  REGULATION: 4,
  CMR: 9,
} as const;

interface ProhibitedRecord {
  ingredient: string;
  referenceNumber: string;
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

function parseRows(): ProhibitedRecord[] {
  const csvContent = fs.readFileSync(SOURCE_FILE, 'utf8');
  const rows: unknown[][] = parse(csvContent, { relax_column_count: true });

  const records: ProhibitedRecord[] = [];

  for (const row of rows.slice(DATA_START_ROW)) {
    const referenceNumber = cell(row, COL.REFERENCE_NUMBER);
    if (!referenceNumber) continue; // trailing blank rows

    const chemicalName = cell(row, COL.CHEMICAL_NAME);
    if (!chemicalName) continue; // no identifiable substance name

    const regulation = toNullable(cell(row, COL.REGULATION));
    const cmr = toNullable(cell(row, COL.CMR));

    records.push({ ingredient: chemicalName.toLowerCase(), referenceNumber, regulation, cmr });
  }

  return records;
}

export async function loadCosingProhibited(): Promise<void> {
  const records = parseRows();
  console.log(`  Parsed ${records.length} substance/prohibition row(s) from Annex II...`);

  const pool = getDb();
  for (const r of records) {
    await pool.query(
      `INSERT INTO cosing_prohibited_substances (ingredient, reference_number, regulation, cmr)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ingredient, reference_number) DO UPDATE SET
         regulation = EXCLUDED.regulation,
         cmr        = EXCLUDED.cmr,
         updated_at = NOW()`,
      [r.ingredient, r.referenceNumber, r.regulation, r.cmr],
    );
  }
  console.log(`  Done.`);
}

if (require.main === module) {
  loadCosingProhibited()
    .then(() => closeDb())
    .catch(err => { console.error('[07-load-cosing-prohibited] Failed:', err); process.exit(1); });
}
