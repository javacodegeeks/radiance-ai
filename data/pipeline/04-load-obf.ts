/**
 * Step 4 — Download the Open Beauty Facts MongoDB dump and restore it.
 *
 * Uses SHA256-based caching: skips download if the remote file hasn't changed.
 * Dump is cached at data/.cache/ (git-ignored).
 *
 * Requires: mongorestore (part of mongodb-database-tools) on PATH.
 *   macOS:  brew install mongodb-database-tools
 *   Ubuntu: apt-get install mongodb-database-tools
 */
import { loadDump } from '../src/infra/dataLoader';

const DUMP_URL = 'https://static.openbeautyfacts.org/data/openbeautyfacts-mongodbdump.gz';
const SHA256SUM_URL = 'https://static.openbeautyfacts.org/data/gz-sha256sum';
const LOCAL_FILE = 'openbeautyfacts-mongodbdump.gz';

export async function loadOBF() {
  await loadDump({
    dumpUrl: DUMP_URL,
    sha256Url: SHA256SUM_URL,
    localFile: LOCAL_FILE,
    mongoNamespaceFrom: 'obf',
  });
}

if (require.main === module) {
  loadOBF().catch(err => { console.error('[04-load-obf] Failed:', err); process.exit(1); });
}
