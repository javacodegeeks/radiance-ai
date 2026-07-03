import { GraphStateType } from '../graph/state';
import { findIngredients } from '../common/inci';
import { RepositoryError } from '../common/errors';
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
    const label = err instanceof RepositoryError ? 'DB/vector search failed' : 'Search failed';
    console.error(`[productFinder] ${label} — returning empty results`, err);
    return { catalogResults: [] };
  }
}

async function buildQuery(query: string): Promise<string> {
  const inci = await findIngredients(query);
  return `parapharmaceutical products for ${query} ${inci ? `with ingredients: ${inci}` : ''}`.trim();
}
