/**
 * Postgres pool for the shared ingredient/CosIng safety reference tables
 * (cosmetic_rai db) — same instance ai/src/infra/db.ts already reads from.
 * Package independence means this is a small duplicate of that file, not a
 * shared import. Read-only from admin/server.
 */
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    console.log(`[postgres] Creating pool host=${process.env.DB_HOST}:${process.env.DB_PORT} db=${process.env.DB_NAME}`);
    pool = new Pool({
      host:     process.env.DB_HOST,
      port:     Number.parseInt(process.env.DB_PORT!, 10),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 10,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis:  2_000,
    });
    pool.on('error', (err) => { console.error('[postgres] Unexpected pool error:', err); });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[postgres] Pool closed');
  }
}
