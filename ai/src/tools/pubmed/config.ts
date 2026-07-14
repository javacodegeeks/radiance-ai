// ─── Article type → PubMed MeSH publication type filter ──────────────────────

export const ARTICLE_TYPE_MESH: Record<string, string> = {
  rct:               'Randomized Controlled Trial[pt]',
  systematic_review: 'Systematic Review[pt]',
  meta_analysis:     'Meta-Analysis[pt]',
  clinical_trial:    'Clinical Trial[pt]',
};

// ─── Runtime configuration ────────────────────────────────────────────────────

export interface PubMedConfig {
  baseUrl: string;
  apiKey: string | undefined;
  defaultMaxResults: number;
  cacheTtlMs: number;
  /** Minimum delay between requests to stay within NCBI rate limits */
  requestDelayMs: number;
  db: string;
}

/**
 * Build config from environment at call time so tests can override env vars.
 * NCBI limits: 3 req/s without API key, 10 req/s with API key.
 */
export function getConfig(): PubMedConfig {
  const hasApiKey = !!process.env.NCBI_API_KEY;
  return {
    baseUrl:           'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    apiKey:            process.env.NCBI_API_KEY || undefined,
    defaultMaxResults: 5,
    cacheTtlMs:        parseInt(process.env.PUBMED_CACHE_TTL_MS ?? '3600000', 10),
    requestDelayMs:    hasApiKey ? 110 : 350,
    db:                'pubmed',
  };
}
