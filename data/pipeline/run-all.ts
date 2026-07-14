/**
 * Full data pipeline — runs all steps in sequence.
 *
 *   npm run pipeline
 *
 * Steps:
 *   01 — Run PostgreSQL schema migrations
 *   02 — Seed ingredient safety rules into PostgreSQL
 *   03 — Download OBF dump and restore into MongoDB  (~250 MB, skipped if up to date)
 *   04 — Generate embeddings for all products and load into Qdrant
 *
 * Each step can also be run individually:
 *   npm run pipeline:migrate
 *   npm run pipeline:safety
 *   npm run pipeline:load
 *   npm run pipeline:vectorize [limit]
 */
import { closeDb as closePg } from '../src/infra/db';
import { closeDb as closeMongo } from '../src/infra/mongo';
import { migrateDb } from './01-migrate';
import { seedSafetyRules } from './02-seed-safety';
import { loadOBF } from './04-load-obf';
import { vectorizeProducts } from './05-vectorize';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Radiance AI — Data Pipeline        ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('Step 1/4 — PostgreSQL migrations');
  await migrateDb();

  console.log('\nStep 2/4 — Safety rules seed');
  await seedSafetyRules();

  // console.log('\nStep 3/4 — Load OFF product catalogue into MongoDB');
  // await loadOFF();

  console.log('\nStep 4/4 — Load OBF product catalogue into MongoDB');
  await loadOBF();

  console.log('\nStep 5/5 — Vectorize products → Qdrant');
  await vectorizeProducts();

  console.log('\n✓ Pipeline complete.\n');
  await closePg();
  await closeMongo();
}

main().catch(err => {
  console.error('\n[pipeline] Failed:', err);
  process.exit(1);
});
