/**
 * Step 3 — Download the Open Beauty Facts MongoDB dump and restore it.
 *
 * Uses ETag-based caching: skips download if the remote file hasn't changed.
 * Dump is cached at data/.cache/ (git-ignored).
 *
 * Requires: mongorestore (part of mongodb-database-tools) on PATH.
 *   macOS:  brew install mongodb-database-tools
 *   Ubuntu: apt-get install mongodb-database-tools
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DUMP_URL = 'https://static.openbeautyfacts.org/data/openbeautyfacts-mongodbdump.gz';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const LOCAL_FILE = path.join(CACHE_DIR, 'openbeautyfacts-mongodbdump.gz');
const ETAG_FILE = `${LOCAL_FILE}.etag`;

function fetchEtag(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { method: 'HEAD' }, res => {
      const etag = res.headers['etag'];
      resolve(typeof etag === 'string' ? etag.replace(/"/g, '') : null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let downloaded = 0;
      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  Downloading... ${pct}% (${Math.round(downloaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)  `);
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

export async function loadProducts(): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const remoteEtag = await fetchEtag(DUMP_URL);

  if (fs.existsSync(LOCAL_FILE) && fs.existsSync(ETAG_FILE)) {
    const savedEtag = fs.readFileSync(ETAG_FILE, 'utf8').trim();
    if (remoteEtag && remoteEtag === savedEtag) {
      console.log('  OBF dump is up to date — skipping download.');
    } else {
      console.log('  OBF dump has changed — downloading fresh copy...');
      await downloadFile(DUMP_URL, LOCAL_FILE);
      if (remoteEtag) fs.writeFileSync(ETAG_FILE, remoteEtag);
    }
  } else {
    console.log('  No cached dump — downloading (~250 MB)...');
    await downloadFile(DUMP_URL, LOCAL_FILE);
    if (remoteEtag) fs.writeFileSync(ETAG_FILE, remoteEtag);
  }

  const host = process.env.MONGO_HOST;
  const port = process.env.MONGO_PORT;
  const user = process.env.MONGO_USER;
  const password = process.env.MONGO_PASSWORD;

  console.log(`  Restoring dump to MongoDB at ${host}:${port}...`);
  execSync(
    `mongorestore --host ${host}:${port} --username ${user} --password ${password} --authenticationDatabase admin --gzip --archive="${LOCAL_FILE}" --drop`,
    { stdio: 'inherit' },
  );
  console.log('  MongoDB restore complete.');
}

if (require.main === module) {
  loadProducts().catch(err => { console.error('[03-load-products] Failed:', err); process.exit(1); });
}
