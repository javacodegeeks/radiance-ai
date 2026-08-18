/**
 * Step 9 — Load the EU CosIng Functions glossary (~83 ingredient function
 * categories, e.g. UV FILTER, EXFOLIATING, SKIN CONDITIONING) and the
 * ingredients that carry each function into PostgreSQL.
 *
 * Unlike 06-load-cosing-restrictions.ts / 07-load-cosing-prohibited.ts, this
 * step doesn't parse a source file at runtime — the raw crawl
 * (functions.json + ingredients-by-function/*.json, pulled via
 * fetch-cosing-search-api.sh from the undocumented "search-api" backend
 * documented in docs/specs/cosing-functions-classification-enrichment.md)
 * was a one-time, rate-limited batch pull and has since been deleted once its
 * data was fully loaded and verified. cosing-functions-seed/ is the durable
 * artifact: a directory of pre-generated, idempotent SQL files (entity
 * tables upsert on their natural key, child/junction tables use ON CONFLICT
 * DO NOTHING on their composite PK) containing the actual INSERT statements
 * — see data/migrations/007_cosing_functions.sql for the schema they target.
 *
 * Split into multiple files (each under 25 MB, mainly the `ingredient` table
 * chunked into 4 parts) instead of one large seed script, and applied in
 * filename order (numeric prefixes encode the required order: functions
 * before the ingredients that reference them, ingredients before their
 * child/junction rows).
 *
 * Safe to re-run: re-running just re-applies the same idempotent inserts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getDb, closeDb } from '../src/infra/db';

const SEED_DIR = path.join(__dirname, 'cosing-functions-seed');

export async function loadCosingFunctions(): Promise<void> {
  const pool = getDb();
  const files = fs.readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(SEED_DIR, file), 'utf8');
    console.log(`  Applying ${file}...`);
    await pool.query(sql);
  }
  console.log(`  Done.`);
}

if (require.main === module) {
  loadCosingFunctions()
    .then(() => closeDb())
    .catch(err => { console.error('[09-load-cosing-functions] Failed:', err); process.exit(1); });
}
