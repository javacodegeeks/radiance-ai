/**
 * Step 1 — Run PostgreSQL schema migrations.
 * Safe to run repeatedly (CREATE IF NOT EXISTS / ON CONFLICT).
 */
import { runMigrations } from '../src/infra/migrate';
import { closeDb } from '../src/infra/db';

export async function migrateDb(): Promise<void> {
  await runMigrations();
}

if (require.main === module) {
  migrateDb()
    .then(() => closeDb())
    .catch(err => { console.error('[01-migrate] Failed:', err); process.exit(1); });
}
