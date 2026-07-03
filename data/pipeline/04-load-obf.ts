/**
 * Step 3 — Download the Open Beauty Facts MongoDB dump and restore it.
 *
 * Uses SHA256-based caching: skips download if the remote file hasn't changed.
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
const SHA256SUM_URL = 'https://static.openbeautyfacts.org/data/gz-sha256sum';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const LOCAL_FILE = path.join(CACHE_DIR, 'openbeautyfacts-mongodbdump.gz');
const CHECKSUM_FILE = `${LOCAL_FILE}.sha256`;

export function getResumeOffset(partialFile: string): number {
  return fs.existsSync(partialFile) ? fs.statSync(partialFile).size : 0;
}

export function getDownloadRequestOptions(url: string, resumeOffset: number): http.RequestOptions {
  if (resumeOffset <= 0) {
    return {};
  }

  return {
    headers: {
      Range: `bytes=${resumeOffset}-`,
    },
  };
}

export function getRedirectUrl(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString();
}

function fetchChecksum(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, res => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        const line = body.split(/\r?\n/).find(entry => entry.includes('openbeautyfacts-mongodbdump.gz'));
        const checksum = line?.trim().split(/\s+/)[0] ?? null;
        resolve(checksum);
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function downloadFile(url: string, dest: string, resumeOffset = getResumeOffset(`${dest}.part`)): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = `${dest}.part`;
    const effectiveOffset = Math.max(resumeOffset, getResumeOffset(tempDest));
    const file = fs.createWriteStream(tempDest, { flags: effectiveOffset > 0 ? 'a' : 'w' });
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, getDownloadRequestOptions(url, effectiveOffset), res => {
      if (res.statusCode && (res.statusCode >= 300 && res.statusCode < 400) && res.headers.location) {
        res.resume();
        file.end(() => {
          const redirectUrl = getRedirectUrl(url, res.headers.location as string);
          resolve(downloadFile(redirectUrl, dest, effectiveOffset));
        });
        return;
      }

      if (res.statusCode === 416) {
        file.end(() => {
          fs.unlinkSync(tempDest);
          resolve(downloadFile(url, dest, 0));
        });
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        file.destroy();
        reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        return;
      }

      const contentRange = res.headers['content-range'];
      const total = parseInt(contentRange?.split('/').pop() ?? res.headers['content-length'] ?? '0', 10);
      let downloaded = effectiveOffset;
      let lastLogged = 0;

      if (effectiveOffset > 0) {
        console.log(`  Resuming download from ${Math.round(effectiveOffset / 1024 / 1024)}MB...`);
      }

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const displayTotal = total > 0 ? total : downloaded;
        if (displayTotal > 0) {
          const pct = Math.round((downloaded / displayTotal) * 100);
          if (Date.now() - lastLogged >= 1000 || pct >= 100) {
            process.stdout.write(`\r  Downloading... ${pct}% (${Math.round(downloaded / 1024 / 1024)}MB / ${Math.round(displayTotal / 1024 / 1024)}MB)  `);
            lastLogged = Date.now();
          }
        } else if (downloaded >= 1024 * 1024 * 50 && Date.now() - lastLogged >= 1000) {
          process.stdout.write(`\r  Downloading... ${Math.round(downloaded / 1024 / 1024)}MB received  `);
          lastLogged = Date.now();
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tempDest, dest);
          console.log();
          resolve();
        });
      });
      file.on('error', err => {
        file.destroy();
        fs.unlinkSync(tempDest);
        reject(err);
      });
      res.on('error', err => {
        file.destroy();
        fs.unlinkSync(tempDest);
        reject(err);
      });
    });

    req.on('error', err => {
      fs.unlinkSync(tempDest);
      reject(err);
    });
  });
}

export async function loadOBF(): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const remoteChecksum = await fetchChecksum(SHA256SUM_URL);

  if (fs.existsSync(LOCAL_FILE) && fs.existsSync(CHECKSUM_FILE)) {
    const savedChecksum = fs.readFileSync(CHECKSUM_FILE, 'utf8').trim();
    if (remoteChecksum && remoteChecksum === savedChecksum) {
      console.log('  OBF dump is up to date — skipping download.');
    } else {
      console.log('  OBF dump has changed — downloading fresh copy...');
      await downloadFile(DUMP_URL, LOCAL_FILE);
      if (remoteChecksum) fs.writeFileSync(CHECKSUM_FILE, remoteChecksum);
    }
  } else {
    console.log('  No cached dump — downloading (~100 MB)...');
    await downloadFile(DUMP_URL, LOCAL_FILE);
    if (remoteChecksum) fs.writeFileSync(CHECKSUM_FILE, remoteChecksum);
  }

  const host = process.env.MONGO_HOST;
  const port = process.env.MONGO_PORT;
  const user = process.env.MONGO_USER;
  const password = process.env.MONGO_PASSWORD;
  const dbName = process.env.MONGO_DB_NAME;

  console.log(`  Restoring dump to MongoDB at ${host}:${port} (~700 MB)...`);
  execSync(
    `mongorestore --host ${host}:${port} --username ${user} --password ${password} --authenticationDatabase admin --gzip --archive="${LOCAL_FILE}" --nsFrom "obf.*" --nsTo "${dbName}.*"`,
    { stdio: 'inherit' },
  );
  console.log('  MongoDB restore complete.');
}

if (require.main === module) {
  loadOBF().catch(err => { console.error('[03-load-obf] Failed:', err); process.exit(1); });
}
