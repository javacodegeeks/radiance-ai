import { GraphStateType } from '../graph/state';
import { chatCompletion } from '../llm/client';
import { PRODUCT_FINDER_INCI_SYSTEM } from '../llm/prompts';
import { LlmCallError, RepositoryError } from '../common/errors';
import { generateEmbedding } from '../llm/embeddings';
import { findSimilarProducts } from '../repositories/productRepository';

const MAX_RESULTS = 10;

/**
 * Product finder agent.
 * Primary product source — searches the internal catalog for suitable products.
 * Falls back to an empty result (catalog fallback handled by Supervisor routing).
 */
export async function productFinderAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { userQuery, queryContext, userProfile } = state;
  const country = userProfile.country;

  const query = await buildQuery(queryContext.refinedIssue ?? userQuery);

  console.log(`[productFinder] query="${query}"`);
  try {
    const embedding = await generateEmbedding(query);
    console.log(`[productFinder] embedding dims=${embedding.length}`);
    const products  = await findSimilarProducts(embedding, MAX_RESULTS, country);
    console.log(`[productFinder] found ${products.length} product(s)`);
    console.log(`[productFinder] products=${products.map(p => p.name).join(', ')}`);
    return { catalogResults: products };
  } catch (err) {
    const label = err instanceof RepositoryError ? 'DB/vector search failed'
                : 'Search failed';
    console.error(`[productFinder] ${label} — returning empty results`, err);
    return { catalogResults: [] };
  }
}

async function buildQuery(query: string): Promise<string> {
  const inci = await findIngredients(query);
  return `cosmetic skincare products for ${query} ${inci ? `with ingredients: ${inci}` : ''}`.trim();
}

/**
 * Extract comma-separated INCI ingredient list from potentially chatty LLM response.
 */
function extractInciList(text: string): string | null {
  const normalized = text.trim();

  if (!normalized || /^unknown$/i.test(normalized) || /(no ingredient|unable to determine|n\/a)/i.test(normalized)) {
    return null;
  }

  if (normalized.length < 200 && normalized.includes(',')) {
    return normalized;
  }

  const lines = normalized.split(/[.\n]+/).filter((line) => line.trim());

  let bestMatch: string | null = null;
  let bestMatchCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (/:\s*$/.test(trimmedLine)) continue;
    if (/\b(recommend|following|provide|making|suitable|properties)\b/i.test(trimmedLine)) continue;
    if (/^(for|these|here|the|to|and|i)\s+/i.test(trimmedLine) && trimmedLine.split(',').length < 3) continue;

    if (trimmedLine.includes(',')) {
      const itemCount = trimmedLine.split(',').length;
      if (itemCount >= 2 && itemCount > bestMatchCount) {
        bestMatch = trimmedLine;
        bestMatchCount = itemCount;
      }
    }
  }

  return bestMatch;
}

async function findIngredients(content: string): Promise<string | null> {
  const normalizedContent = content.trim();
  if (!normalizedContent) return null;

  try {
    console.log('[productFinder] prompt=PRODUCT_FINDER_INCI_SYSTEM');
    const rawText = (await chatCompletion('productFinder', [
      { role: 'system', content: PRODUCT_FINDER_INCI_SYSTEM },
      { role: 'user',   content: `Return a comma-separated INCI-formatted list of the most suitable ingredients for: ${normalizedContent}\n\nRespond with ONLY the comma-separated list or "Unknown". No other text.` },
    ])).trim();
    return extractInciList(rawText);
  } catch (error) {
    const e = new LlmCallError('productFinder', 'Ingredient proposition failed', error);
    console.error(`[productFinder] ${e.name}: ${e.message}`, error);
    return null;
  }
}
