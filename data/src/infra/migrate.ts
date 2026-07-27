import * as fs from 'fs';
import * as path from 'path';
import { getDb, closeDb } from './db';

export async function runMigrations(): Promise<void> {
  const db = getDb();
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`  applying ${file}`);
    await db.query(sql);
  }

  console.log('Migrations complete.\n');
}

if (require.main === module) {
  runMigrations()
    .then(() => closeDb())
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
}
