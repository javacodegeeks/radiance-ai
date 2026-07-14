import { getConfig, ARTICLE_TYPE_MESH } from './config';
import { pubmedCache } from './cache';
import { parseAbstractsXml } from './xmlParser';
import type { ParsedAbstract } from './xmlParser';
import type {
  RawEsearchResponse,
  RawEsummaryResponse,
  RawEsummaryDocsum,
  SearchFilters,
} from './types';
import { PubMedError } from './types';

// ─── URL helpers ──────────────────────────────────────────────────────────────

function buildQueryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v!))}`)
    .join('&');
}

/**
 * Append PubMed search filters (date range, article types, free full-text)
 * to the base query using PubMed's standard Boolean filter syntax.
 */
function buildFilteredQuery(query: string, filters: SearchFilters): string {
  const parts = [query.trim()];

  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ?? '1900/01/01';
    const to   = filters.dateTo   ?? '3000/12/31';
    parts.push(`("${from}"[PDAT] : "${to}"[PDAT])`);
  }

  if (filters.articleTypes?.length) {
    const typeParts = filters.articleTypes
      .map(t => ARTICLE_TYPE_MESH[t])
      .filter(Boolean);
    if (typeParts.length) {
      parts.push(`(${typeParts.join(' OR ')})`);
    }
  }

  if (filters.freeFullText) {
    parts.push('free full text[sb]');
  }

  return parts.join(' AND ');
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

/**
 * Fetch with automatic retry and rate-limit handling.
 * HTTP 429 triggers a back-off wait before retrying.
 */
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);

      if (res.status === 429) {
        lastError = new PubMedError(
          'RATE_LIMITED',
          `NCBI rate limit hit (attempt ${attempt + 1})`,
        );
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error
        ? err
        : new PubMedError('NETWORK_ERROR', String(err));

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new PubMedError('NETWORK_ERROR', 'Unknown fetch error');
}

// ─── Public client functions ──────────────────────────────────────────────────

/**
 * Search PubMed via esearch.fcgi.
 * Returns PMID list and total count matching the query.
 */
export async function searchPmids(
  query: string,
  filters: SearchFilters = {},
): Promise<{ pmids: string[]; totalFound: number }> {
  if (!query?.trim()) {
    throw new PubMedError('INVALID_QUERY', 'Search query must not be empty');
  }

  const config   = getConfig();
  const cacheKey = pubmedCache.buildKey('search', query, filters);
  const cached   = pubmedCache.get<{ pmids: string[]; totalFound: number }>(cacheKey);
  if (cached) {
    console.log(`[pubmed] cache hit: search "${query}"`);
    return cached;
  }

  const filteredQuery = buildFilteredQuery(query, filters);
  const params: Record<string, string | number | undefined> = {
    db:         config.db,
    term:       filteredQuery,
    retmode:    'json',
    retmax:     filters.maxResults ?? config.defaultMaxResults,
    retstart:   filters.retstart ?? 0,
    usehistory: 'n',
    ...(config.apiKey && { api_key: config.apiKey }),
  };

  console.log(`[pubmed] esearch query="${filteredQuery}"`);
  const res = await fetchWithRetry(
    `${config.baseUrl}/esearch.fcgi?${buildQueryString(params)}`,
  );

  if (!res.ok) {
    throw new PubMedError(
      'SEARCH_FAILED',
      `esearch returned HTTP ${res.status}`,
      { query },
    );
  }

  const data   = await res.json() as RawEsearchResponse;
  const result = {
    pmids:      data.esearchresult.idlist ?? [],
    totalFound: parseInt(data.esearchresult.count ?? '0', 10),
  };

  console.log(
    `[pubmed] esearch: ${result.totalFound} total, returning ${result.pmids.length} PMIDs`,
  );
  pubmedCache.set(cacheKey, result, config.cacheTtlMs);
  return result;
}

/**
 * Fetch structured metadata for a list of PMIDs via esummary.fcgi.
 * Returns a Map<pmid, RawEsummaryDocsum> for efficient O(1) lookup.
 */
export async function fetchMetadata(
  pmids: string[],
): Promise<Map<string, RawEsummaryDocsum>> {
  if (!pmids.length) return new Map();

  const config   = getConfig();
  const cacheKey = pubmedCache.buildKey('meta', pmids.join(','));
  const cached   = pubmedCache.get<Map<string, RawEsummaryDocsum>>(cacheKey);
  if (cached) {
    console.log(`[pubmed] cache hit: metadata for ${pmids.length} PMIDs`);
    return cached;
  }

  const params: Record<string, string | number | undefined> = {
    db:      config.db,
    id:      pmids.join(','),
    retmode: 'json',
    ...(config.apiKey && { api_key: config.apiKey }),
  };

  console.log(`[pubmed] esummary for ${pmids.length} PMIDs`);
  const res = await fetchWithRetry(
    `${config.baseUrl}/esummary.fcgi?${buildQueryString(params)}`,
  );

  if (!res.ok) {
    throw new PubMedError('METADATA_FAILED', `esummary returned HTTP ${res.status}`);
  }

  const data   = await res.json() as RawEsummaryResponse;
  const result = new Map<string, RawEsummaryDocsum>();

  for (const pmid of pmids) {
    const doc = data.result[pmid];
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      result.set(pmid, doc as RawEsummaryDocsum);
    }
  }

  pubmedCache.set(cacheKey, result, config.cacheTtlMs);
  return result;
}

/**
 * Fetch and XML-parse article abstracts for a list of PMIDs via efetch.fcgi.
 * Returns a Map<pmid, ParsedAbstract> for efficient O(1) lookup.
 */
export async function fetchAbstracts(
  pmids: string[],
): Promise<Map<string, ParsedAbstract>> {
  if (!pmids.length) return new Map();

  const config   = getConfig();
  const cacheKey = pubmedCache.buildKey('abstract', pmids.join(','));
  const cached   = pubmedCache.get<Map<string, ParsedAbstract>>(cacheKey);
  if (cached) {
    console.log(`[pubmed] cache hit: abstracts for ${pmids.length} PMIDs`);
    return cached;
  }

  const params: Record<string, string | number | undefined> = {
    db:      config.db,
    id:      pmids.join(','),
    retmode: 'xml',
    rettype: 'abstract',
    ...(config.apiKey && { api_key: config.apiKey }),
  };

  console.log(`[pubmed] efetch for ${pmids.length} PMIDs`);
  const res = await fetchWithRetry(
    `${config.baseUrl}/efetch.fcgi?${buildQueryString(params)}`,
  );

  if (!res.ok) {
    throw new PubMedError('ABSTRACT_FAILED', `efetch returned HTTP ${res.status}`);
  }

  const xml    = await res.text();
  const parsed = parseAbstractsXml(xml); // throws PubMedError on malformed XML

  const result = new Map<string, ParsedAbstract>();
  for (const a of parsed) {
    if (a.pmid) result.set(a.pmid, a);
  }

  pubmedCache.set(cacheKey, result, config.cacheTtlMs);
  return result;
}
