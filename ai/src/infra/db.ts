import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({
      host:     process.env.DB_HOST,
      port:     Number.parseInt(process.env.DB_PORT!, 10),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis:  2_000,
    });
    pool.on('error', (err) => { console.error('[pg] Unexpected pool error:', err); });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
