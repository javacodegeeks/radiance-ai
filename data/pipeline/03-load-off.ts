/**
 * Step 3 — Download the Open Food Facts MongoDB dump and restore it.
 *
 * Uses SHA256-based caching: skips download if the remote file hasn't changed.
 * Dump is cached at data/.cache/ (git-ignored).
 *
 * Requires: mongorestore (part of mongodb-database-tools) on PATH.
 *   macOS:  brew install mongodb-database-tools
 *   Ubuntu: apt-get install mongodb-database-tools
 */
import { loadDump } from '../src/infra/dataLoader';

const DUMP_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-mongodbdump.gz';
const SHA256SUM_URL = 'https://static.openfoodfacts.org/data/gz-sha256sum';
const LOCAL_FILE = 'openfoodfacts-mongodbdump.gz';

export async function loadOFF() {
  await loadDump({
    dumpUrl: DUMP_URL,
    sha256Url: SHA256SUM_URL,
    localFile: LOCAL_FILE,
    mongoNamespaceFrom: 'off',
    drop: true
  });
}

if (require.main === module) {
  loadOFF().catch(err => { console.error('[03-load-off] Failed:', err); process.exit(1); });
}
