import { ProductDocument, ProductRepository } from '../../../data/src/repositories/productRepository';
import { generateEmbedding } from '../../../data/src/qdrant';
import { GraphStateType } from '../graph/state';
import { Product } from '../types';
import { llmClient, llmConfig } from '../llm/client';

const MAX_RESULTS = 10;

const repo = new ProductRepository();

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
    const rawResults = await repo.findSimilar(embedding, MAX_RESULTS, country);
    const products = parseResults(rawResults);
    console.log(`[productFinder] found ${products.length} product(s)`);
    console.log(`[productFinder] products=${products.map(p => p.name).join(', ')}`);
    return { catalogResults: products };
  } catch (err) {
    console.error('[productFinder] Search failed — returning empty results:', err);
    return { catalogResults: [] };
  }
}

async function buildQuery(query: string): Promise<string> {
  const inci = await findIngredients(query);
  return `cosmetic skincare products for ${query} ${inci ? `with ingredients: ${inci}` : ''}`.trim();
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map(s => s.trim());
  return [];
}

function parseResults(results: ProductDocument[]): Product[] {
  return results.map((r) => ({
    name:                r.product_name ?? r.product_name_en ?? 'Unknown Product',
    brand:               r.brands ?? 'Unknown Brand',
    inci:                toArray(r.ingredients),
    categories:          toArray(r.categories),
    countryAvailability: toArray(r.countries),
    cachedAt:            r.cached_at,
  }));
}

/**
 * Extract comma-separated INCI ingredient list from potentially chatty LLM response.
 * If the response contains multiple sentences, attempts to find and extract the ingredient list.
 */
function extractInciList(text: string): string | null {
  const normalized = text.trim();

  // Check for "Unknown" or similar rejections
  if (!normalized || /^unknown$/i.test(normalized) || /(no ingredient|unable to determine|n\/a)/i.test(normalized)) {
    return null;
  }

  // If the text is relatively short and comma-separated, likely a direct list
  if (normalized.length < 200 && normalized.includes(',')) {
    return normalized;
  }

  // Try to extract comma-separated list from longer chatty response
  // Look for lines with multiple comma-separated words (likely ingredients)
  const lines = normalized.split(/[.\n]+/).filter((line) => line.trim());

  let bestMatch: string | null = null;
  let bestMatchCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip lines that are clearly preamble or explanatory:
    // - Lines ending with ':' (like "ingredients:" or "following ingredients:")
    if (/:\s*$/.test(trimmedLine)) {
      continue;
    }

    // - Lines containing descriptive/instructional keywords
    if (/\b(recommend|following|provide|making|suitable|properties)\b/i.test(trimmedLine)) {
      continue;
    }

    // - Lines that start with preamble keywords and have few commas (not a full ingredient list)
    if (/^(for|these|here|the|to|and|i)\s+/i.test(trimmedLine) && trimmedLine.split(',').length < 3) {
      continue;
    }

    // Check if this line looks like an ingredient list (has multiple comma-separated items)
    if (trimmedLine.includes(',')) {
      const itemCount = trimmedLine.split(',').length;
      // If there are at least 2 comma-separated items, it could be an ingredient list
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
  if (!normalizedContent) {
    return null;
  }

  try {
    const response = await llmClient.chat.completions.create({
      model: llmConfig.model,
      temperature: 0.0,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content:
            'You are a cosmetics ingredient research assistant. Your ONLY job is to return a comma-separated INCI-formatted list of suitable ingredients. Return NOTHING ELSE—no explanations, no sentences, only the ingredient list. If you cannot determine suitable ingredients, respond with: Unknown',
        },
        {
          role: 'user',
          content: `Return a comma-separated INCI-formatted list of the most suitable ingredients for: ${normalizedContent}\n\nRespond with ONLY the comma-separated list or "Unknown". No other text.`,
        },
      ],
    });

    const rawText = String(response?.choices?.[0]?.message?.content ?? '').trim();
    const extracted = extractInciList(rawText);

    if (extracted) {
      return extracted;
    }

    return null;
  } catch (error) {
    console.error('[productFinder] Ingredient proposition failed:', error);
    return null;
  }
}
