import { TavilySearch } from '@langchain/tavily';
import { GraphStateType } from '../graph/state';
import { findIngredients } from '../common/inci';
import { Product } from '../types';
import { chatCompletion, stripJsonFences } from '../llm/client';
import { WEB_RESEARCHER_PRODUCT_SYSTEM } from '../llm/prompts';
import { LlmCallError } from '../common/errors';
import { CircuitBreaker, withTimeout } from '../common/resilience';

const MAX_RESULTS = 10;
const TAVILY_TIMEOUT_MS = 8_000;

// Trip after 3 consecutive Tavily failures/timeouts, stay open for 60s so a
// degraded/down search provider doesn't stall every chat request behind it.
const tavilyBreaker = new CircuitBreaker('webResearcher.tavily', {
  failureThreshold: 3,
  cooldownMs: 60_000,
});

const PRODUCT_QUERY_HINTS = `
"official product page"
"add to cart"
"buy"
"ingredients"
"price"
"size"
"in stock"
`;

const PRODUCT_DOMAINS = [
  "sephora.com",
  "ulta.com",
  "lookfantastic.com",
  "cultbeauty.com",
  "boots.com",
  "dermstore.com",
  "stylevana.com",
  "yesstyle.com",
  "spacenk.com",
  "paulaschoice.com",
  "cerave.com",
  "laroche-posay.com",
  "eucerin.com",
  "aveneusa.com",
  "skinceuticals.com",
  "theordinary.com",
  "deciem.com",
];

const EXCLUDED_SOCIAL_DOMAINS = [
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'facebook.com',
  'twitter.com',
  'youtube.com',
  'reddit.com',
  'medium.com',
  'blogger.com',
];

export interface ExtractedProductInfo {
  brand: string | null;
  productName: string | null;
  price: number | null;
  currency: string | null;
  size: string | null;
  ingredients: string[];
  available: boolean | null;
}

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

  const query = await buildQuery(queryContext.refinedIssue ?? userQuery, country);

  if (tavilyBreaker.isOpen()) {
    console.warn('[webResearcher] Circuit open — skipping Tavily search, returning empty results');
    return { webResults: [] };
  }

  try {
    const rawResults = await withTimeout(runTavilySearch(query), TAVILY_TIMEOUT_MS, 'Tavily search');
    const products   = await parseResults(rawResults, country);
    tavilyBreaker.recordSuccess();
    return { webResults: products };
  } catch (err) {
    tavilyBreaker.recordFailure();
    console.error('[webResearcher] Search failed — returning empty results:', err);
    return { webResults: [] };
  }
}

async function buildQuery(query: string, country?: string): Promise<string> {
  const inci = await findIngredients(query);

  const availability =
    country
      ? `"available in ${country}" OR "ships to ${country}" OR "buy ${country}"`
      : "";

  return [query, 'pharmaceutical or parapharmaceutical product', PRODUCT_QUERY_HINTS, inci, availability]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runTavilySearch(query: string): Promise<unknown[]> {
  console.log('[webResearcher] Running Tavily search:', query);
  const tool = new TavilySearch({
    maxResults: MAX_RESULTS,
    searchDepth: 'advanced',
    includeRawContent: 'text',
  });
  const raw = await tool.invoke({
    query,
    excludeDomains: EXCLUDED_SOCIAL_DOMAINS,
    includeDomains: PRODUCT_DOMAINS,
  });
  return raw.results ?? [];
}

function isProductResult(result: { title?: string; url?: string; content?: string }): boolean {

    const url = (result.url ?? "").toLowerCase();
    const text = `${result.title ?? ""} ${result.content ?? ""}`.toLowerCase();

    console.debug(`[webResearcher] Scoring result: ${url}`);

    let score = 0;

    if (/add to cart/.test(text)) score += 5;
    if (/buy now/.test(text)) score += 4;
    if (/ingredients/.test(text)) score += 3;
    if (/size/.test(text)) score += 2;
    if (/price/.test(text)) score += 3;
    if (/in stock/.test(text)) score += 4;
    if (/reviews/.test(text)) score += 1;

    if (/\/products?\//.test(url)) score += 5;
    if (/\/product\//.test(url)) score += 5;
    if (/\/p\//.test(url)) score += 3;

    if (/category/.test(url)) score -= 4;
    if (/ingredients/.test(url)) score -= 6;
    if (/blog/.test(url)) score -= 5;
    if (/news/.test(url)) score -= 5;
    if (/article/.test(url)) score -= 5;
    if (/tag\//.test(url)) score -= 8;

    return score >= 8;
}

async function parseResults(results: unknown[], country?: string): Promise<Product[]> {
  console.log(`[webResearcher] ${results.length} product-like results found`);

  const filtered = (results as Array<{ title?: string; url?: string; content?: string }> || [])
    .filter(isProductResult)
    .slice(0, MAX_RESULTS);

  console.log(`[webResearcher] ${filtered.length} product results found`);

  const products = (
    await Promise.all(filtered.map(async r => {
        const info = await extractProductInfo(
            r.title ?? "",
            r.url ?? "",
            r.content ?? "",
        );

        if (!info || info.available === false) {
            return null;
        }

        return {
            name: info.productName ?? r.title ?? "Unknown Product",
            brand: info.brand ?? "Unknown Brand",
            inci: info.ingredients,
            categories: [],
            countryAvailability: info.available && country ? [country] : [],
            sourceUrl: r.url,
            cachedAt: new Date(),
        } as Product;
    })
  )).filter((p): p is Product => p !== null);

  return products;
}

export async function extractProductInfo(
  title: string,
  url: string,
  content: string,
): Promise<ExtractedProductInfo | null> {

  const normalized = content.trim();

  if (!normalized) {
    return null;
  }

  try {

    const response = await chatCompletion("webResearcher", [
      {
        role: "system",
        content: WEB_RESEARCHER_PRODUCT_SYSTEM,
      },
      {
        role: "user",
        content: `
Extract the cosmetic product.

Page title:
${title}

URL:
${url}

Content:
${normalized}
`,
      },
    ]);

    console.log("[webResearcher] Product extraction response:", response);

    const parsed = JSON.parse(stripJsonFences(response)) as ExtractedProductInfo;

    return {
      brand: parsed.brand ?? null,
      productName: parsed.productName ?? null,
      price: parsed.price ?? null,
      currency: parsed.currency ?? null,
      size: parsed.size ?? null,
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients
        : [],
      available:
        typeof parsed.available === "boolean"
          ? parsed.available
          : null,
    };

  } catch (error) {
    const e = new LlmCallError(
      "webResearcher",
      "Product extraction failed",
      error,
    );

    console.error(
      `[webResearcher] ${e.name}: ${e.message}`,
      error,
    );

    return null;
  }
}
