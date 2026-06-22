import { TavilySearch } from '@langchain/tavily';
import { GraphStateType } from '../graph/state';
import { Product } from '../types';
import { chatCompletion } from '../llm/client';
import { WEB_RESEARCHER_BRAND_SYSTEM } from '../llm/prompts';
import { LlmCallError } from '../common/errors';

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
 * Secondary product source — runs after the internal catalog for finer product matching.
 * Falls back to an empty result (catalog fallback handled by Supervisor routing).
 */
export async function webResearcherAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { userQuery, queryContext, userProfile } = state;
  const country = userProfile.country;

  const query = buildQuery(queryContext.refinedIssue ?? userQuery, country);

  try {
    const rawResults = await runTavilySearch(query);
    const products   = await parseResults(rawResults, country);
    return { webResults: products };
  } catch (err) {
    console.error('[webResearcher] Search failed — returning empty results:', err);
    return { webResults: [] };
  }
}

function buildQuery(query: string, country?: string): string {
  const op = country ? (COUNTRY_OPERATORS[country] ?? `"available in ${country}"`) : '';
  return `cosmetic skincare products for ${query} ${op}`.trim();
}

async function runTavilySearch(query: string): Promise<unknown[]> {
  const tool = new TavilySearch({ maxResults: MAX_RESULTS });
  const raw = await tool.invoke({ query: query });
  return raw.results ?? [];
}

async function parseResults(results: unknown[], country?: string): Promise<Product[]> {
  return Promise.all((results as Array<{ title?: string; url?: string; content?: string }>).map(async (r) => ({
    name:                r.title   ?? 'Unknown Product',
    brand:               (await extractBrand(r.content ?? '')) ?? 'Unknown Brand',
    inci:                [],   // TODO: enrich via INCI parser tool
    categories:          [],
    countryAvailability: country ? [country] : [],
    sourceUrl:           r.url,
    cachedAt:            new Date(),
  })));
}

async function extractBrand(content: string): Promise<string | null> {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return null;
  }

  try {
    console.log('[webResearcher] prompt=WEB_RESEARCHER_BRAND_SYSTEM');
    const rawText = (await chatCompletion('webResearcher', [
      { role: 'system', content: WEB_RESEARCHER_BRAND_SYSTEM },
      { role: 'user',   content: `Extract the cosmetic brand from the following web page content. If no brand can be determined, reply with Unknown.\n\n${normalizedContent}` },
    ])).trim();
    const brand = rawText.replace(/^['"]|['"]$/g, '').trim();

    if (!brand || /^unknown$/i.test(brand) || /(no brand|unable to determine|n\/a)/i.test(brand)) {
      return null;
    }

    return brand;
  } catch (error) {
    const e = new LlmCallError('webResearcher', 'Brand extraction failed', error);
    console.error(`[webResearcher] ${e.name}: ${e.message}`, error);
    return null;
  }
}
