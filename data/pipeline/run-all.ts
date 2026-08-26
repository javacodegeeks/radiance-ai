/**
 * Full data pipeline — runs all steps in sequence.
 *
 *   npm run pipeline
 *
 * Steps:
 *   01 — Run PostgreSQL schema migrations
 *   02 — Seed ingredient safety rules into PostgreSQL
 *   03 — Load EU CosIng Annex III/IV/V restrictions
 *   04 — Load EU CosIng Annex II prohibited substances
 *   05 — Load EU CosIng Functions glossary + ingredient mappings
 *   06 — (skipped) Download OFF dump and restore into MongoDB
 *   07 — Download OBF dump and restore into MongoDB  (~250 MB, skipped if up to date)
 *   08 — Generate embeddings for all products and load into Qdrant
 *   09 — Classify products into routine-sequencing categories
 *
 * Each step can also be run individually:
 *   npm run pipeline:migrate
 *   npm run pipeline:safety
 *   npm run pipeline:cosing
 *   npm run pipeline:load
 *   npm run pipeline:vectorize [limit]
 *   npm run pipeline:categorize
 */
import { closeDb as closePg } from '../src/infra/db';
import { closeDb as closeMongo } from '../src/infra/mongo';
import { migrateDb } from './01-migrate';
import { seedSafetyRules } from './02-seed-safety';
import { loadOBF } from './04-load-obf';
import { vectorizeProducts } from './05-vectorize';
import { loadCosingRestrictions } from './06-load-cosing-restrictions';
import { loadCosingProhibited } from './07-load-cosing-prohibited';
import { classifyCategories } from './08-classify-categories';
import { loadCosingFunctions } from './09-load-cosing-functions';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Radiance AI — Data Pipeline        ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('Step 1/9 — PostgreSQL migrations');
  await migrateDb();

  console.log('\nStep 2/9 — Safety rules seed');
  await seedSafetyRules();

  console.log('\nStep 3/9 — Load EU CosIng Annex III/IV/V restrictions');
  await loadCosingRestrictions();

  console.log('\nStep 4/9 — Load EU CosIng Annex II prohibited substances');
  await loadCosingProhibited();

  console.log('\nStep 5/9 — Load EU CosIng Functions glossary + ingredient mappings');
  await loadCosingFunctions();

  // console.log('\nStep 6/9 — Load OFF product catalogue into MongoDB');
  // await loadOFF();

  console.log('\nStep 7/9 — Load OBF product catalogue into MongoDB');
  await loadOBF();

  console.log('\nStep 8/9 — Vectorize products → Qdrant');
  await vectorizeProducts();

  console.log('\nStep 9/9 — Classify products into routine-sequencing categories');
  await classifyCategories();

  console.log('\n✓ Pipeline complete.\n');
  await closePg();
  await closeMongo();
}

main().catch(err => {
  console.error('\n[pipeline] Failed:', err);
  process.exit(1);
});
