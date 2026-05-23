import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { GraphStateType } from '../graph/state';
import { Product } from '../types';

const MAX_RESULTS = 10;

/**
 * Country-specific search operators.
 * Extend this map as more locales are supported.
 */
const COUNTRY_OPERATORS: Record<string, string> = {
  UK:        'site:.co.uk OR "available in UK"',
  Germany:   '"available in Germany" OR "kaufen Deutschland"',
  Spain:     'site:.es OR "disponible en España"',
  France:    'site:.fr OR "disponible en France"',
  US:        'site:.com "ships to US"',
  Australia: 'site:.com.au OR "available in Australia"',
};

/**
 * Web Researcher agent.
 * Primary product source — always runs before the internal catalog.
 * Falls back to an empty result (catalog fallback handled by Supervisor routing).
 */
export async function webResearcherAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { userQuery, userProfile } = state;
  const country = userProfile.country;

  const query = buildQuery(userQuery, country);

  try {
    const rawResults = await runTavilySearch(query);
    const products   = parseResults(rawResults, country);
    return { webResults: products };
  } catch (err) {
    console.error('[webResearcher] Search failed — returning empty results:', err);
    return { webResults: [] };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(query: string, country?: string): string {
  const op = country ? (COUNTRY_OPERATORS[country] ?? `"available in ${country}"`) : '';
  return `cosmetic skincare products for ${query} ${op}`.trim();
}

async function runTavilySearch(query: string): Promise<unknown[]> {
  const tool = new TavilySearchResults({ maxResults: MAX_RESULTS });
  const raw  = await tool.invoke(query);
  return JSON.parse(raw as string) as unknown[];
}

function parseResults(results: unknown[], country?: string): Product[] {
  return (results as Array<{ title?: string; url?: string; content?: string }>).map(r => ({
    name:                r.title   ?? 'Unknown Product',
    brand:               extractBrand(r.content ?? '') ?? 'Unknown Brand',
    inci:                [],   // TODO: enrich via INCI parser tool
    categories:          [],
    countryAvailability: country ? [country] : [],
    sourceUrl:           r.url,
    cachedAt:            new Date(),
  }));
}

function extractBrand(content: string): string | null {
  // TODO: implement LLM-assisted brand extraction from page content
  return null;
}
