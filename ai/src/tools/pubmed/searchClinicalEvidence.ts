import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchPmids, fetchMetadata, fetchAbstracts } from './pubmedClient';
import { normalizeMetadata } from './normalizer';
import type { NormalizedArticle, PubMedSearchResult, SearchFilters, ArticleTypeFilter } from './types';
import { getConfig } from './config';

const ArticleTypeEnum = z.enum(['rct', 'systematic_review', 'meta_analysis', 'clinical_trial']);

// ─── Core orchestration function ─────────────────────────────────────────────

/**
 * Orchestrates the full PubMed evidence retrieval workflow:
 *   1. Search for PMIDs via esearch
 *   2. Fetch metadata (esummary) and abstracts (efetch) in parallel
 *   3. Merge, normalise, and rank results by relevance
 *   4. Return consolidated evidence JSON ready for LLM reasoning
 *
 * This is the primary function for programmatic use inside agents.
 * The LangChain tool wrapper below delegates to this function.
 */
export async function searchClinicalEvidence(
  query: string,
  filters: SearchFilters = {},
): Promise<PubMedSearchResult> {
  if (!query?.trim()) {
    return { query, totalFound: 0, returnedCount: 0, articles: [] };
  }

  const config     = getConfig();
  const maxResults = filters.maxResults ?? config.defaultMaxResults;

  // Step 1 — search PMIDs
  const { pmids, totalFound } = await searchPmids(query, { ...filters, maxResults });
  if (!pmids.length) {
    return { query, totalFound: 0, returnedCount: 0, articles: [] };
  }

  // Step 2 — fetch metadata + abstracts in parallel to minimise latency
  const [metaMap, abstractMap] = await Promise.all([
    fetchMetadata(pmids),
    fetchAbstracts(pmids),
  ]);

  // Step 3 — merge, normalise, and filter out articles with no metadata
  const articles: NormalizedArticle[] = [];

  for (let i = 0; i < pmids.length; i++) {
    const pmid = pmids[i];
    const doc  = metaMap.get(pmid);
    if (!doc) continue;

    const meta         = normalizeMetadata(doc, i, pmids.length);
    const abstractData = abstractMap.get(pmid);

    // Prefer richer article type data from efetch XML; fall back to esummary pubtype
    const articleTypes =
      abstractData?.articleTypes?.length
        ? abstractData.articleTypes
        : (doc.pubtype ?? []);

    articles.push({
      ...meta,
      abstract:     abstractData?.abstract ?? '',
      articleTypes,
    });
  }

  // esearch already returns results ranked by relevance; sorting descending by
  // relevanceScore preserves that order after the merge.
  articles.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    query,
    totalFound,
    returnedCount: articles.length,
    articles,
  };
}

// ─── LangChain tool wrapper ───────────────────────────────────────────────────

/**
 * High-level MCP tool that wraps searchClinicalEvidence for LLM function calling.
 * Returns normalised JSON optimised for downstream LLM reasoning.
 */
// LangChain's tool() overload resolution against this schema shape
// (optional/array/enum-chained Zod fields) triggers TS2589 ("Type
// instantiation is excessively deep and possibly infinite"), which compounds
// across all 5 tool() call sites in this codebase into a multi-minute,
// OOM-crashing `tsc` build. Casting the schema to `any` at the tool()
// call site short-circuits overload resolution; `rawInput` is cast back to
// its real shape below so runtime/type safety inside the tool is unaffected.
const searchClinicalEvidenceToolSchema = z.object({
  query: z
    .string()
    .describe(
      'Clinical search query, e.g. "niacinamide hyperpigmentation treatment efficacy randomized trial"',
    ),
  maxResults: z
    .number().int().min(1).max(10).optional()
    .describe('Max articles to return (default 5, max 10)'),
  dateFrom:     z.string().optional().describe('Start date filter YYYY/MM/DD'),
  dateTo:       z.string().optional().describe('End date filter YYYY/MM/DD'),
  articleTypes: z
    .array(ArticleTypeEnum).optional()
    .describe('Filter: rct, systematic_review, meta_analysis, clinical_trial'),
  freeFullText: z.boolean().optional().describe('Only free full-text articles'),
});
type SearchClinicalEvidenceInput = z.infer<typeof searchClinicalEvidenceToolSchema>;

export const searchClinicalEvidenceTool = tool(
  async (rawInput) => {
    const input = rawInput as SearchClinicalEvidenceInput;
    try {
      const filters: SearchFilters = {
        dateFrom:     input.dateFrom,
        dateTo:       input.dateTo,
        articleTypes: input.articleTypes as ArticleTypeFilter[] | undefined,
        freeFullText: input.freeFullText,
        maxResults:   input.maxResults ?? 5,
      };

      const result = await searchClinicalEvidence(input.query, filters);

      if (!result.articles.length) {
        return JSON.stringify({
          query:      input.query,
          totalFound: 0,
          message:    'No clinical evidence found for this query on PubMed.',
          articles:   [],
        });
      }

      return JSON.stringify(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pubmed] searchClinicalEvidence tool failed query="${input.query}"`, err);
      return JSON.stringify({
        error:    `searchClinicalEvidence failed: ${msg}`,
        query:    input.query,
        articles: [],
      });
    }
  },
  {
    name: 'searchClinicalEvidence',
    description:
      'Retrieve peer-reviewed clinical evidence from PubMed. Searches for articles, ' +
      'fetches metadata and abstracts, and returns normalized ranked JSON ready for ' +
      'LLM reasoning. Use when scientific validation, treatment efficacy comparison, ' +
      'or published research is needed to support a recommendation.',
    schema: searchClinicalEvidenceToolSchema as any,
  },
);
