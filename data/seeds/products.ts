import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import https from 'https';
import { pipeline } from 'stream/promises';

import { getDb, closeDb } from '../src/mongo';

const DUMP_URL = 'https://static.openbeautyfacts.org/data/openbeautyfacts-mongodbdump.gz';
const SEEDS_DIR = __dirname;
const DUMP_FILE = path.join(SEEDS_DIR, 'openbeautyfacts-mongodbdump.gz');

async function downloadDump() {
  if (fs.existsSync(DUMP_FILE)) {
    console.log('✅ Dump already downloaded.');
    return;
  }

  console.log('⬇️  Downloading Open Beauty Facts MongoDB dump... (This may take a while)');
  
  const file = fs.createWriteStream(DUMP_FILE);
  
  await new Promise<void>((resolve, reject) => {
    https.get(DUMP_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }
      pipeline(response, file)
        .then(() => {
          console.log('✅ Download completed!');
          resolve();
        })
        .catch(reject);
    }).on('error', reject);
  });
}

function restoreToMongoDB() {
  console.log('🔄 Restoring using Docker (mongorestore)...');

  const result = spawnSync('docker', [
    'run', '--rm',
    '--network', 'host',
    '-v', `${SEEDS_DIR}:/seed`,
    'mongo:7',
    'mongorestore',
    '--host', 'host.docker.internal:27017',
    '--username', 'mongo',
    '--password', 'mongo',
    '--authenticationDatabase', 'admin',
    '--gzip',
    '--archive=/seed/openbeautyfacts-mongodbdump.gz',
    '--drop',
    '--verbose'
  ], { 
    stdio: 'inherit', 
    shell: true 
  });

  if (result.status === 0) {
    console.log('🎉 Restore completed successfully!');
  } else {
    console.error('❌ Restore failed with code:', result.status);
    process.exit(1);
  }
}

async function verifySeeding() {
  console.log('\n🔍 Verifying seeded data...');
  
  try {
    const db = await getDb();
    const collections = await db.listCollections().toArray();
    
    console.log(`📋 Found ${collections.length} collections`);

    const products = db.collection('products');
    const count = await products.countDocuments();

    console.log(`📊 Total products: ${count}`);

    if (count > 0) {
      const sample = await products.findOne({});
      console.log('\n📝 Sample Product Schema:');
      console.dir(sample, { depth: 4, colors: true });
    } else {
      console.warn('⚠️ No products found.');
    }
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

async function main() {
  try {
    await downloadDump();
    restoreToMongoDB();
    await verifySeeding();

    console.log('\n✅ Open Beauty Facts seeding completed successfully!');
    await closeDb();
  } catch (error) {
    console.error('\n❌ Error during seeding:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});