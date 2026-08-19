import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchPmids } from './pubmedClient';
import type { SearchFilters, ArticleTypeFilter } from './types';

const ArticleTypeEnum = z.enum(['rct', 'systematic_review', 'meta_analysis', 'clinical_trial']);

/**
 * Low-level MCP tool: search PubMed and return matching PMIDs.
 * Use `searchClinicalEvidence` for a complete one-shot workflow that also
 * fetches metadata and abstracts.
 */
// LangChain's tool() overload resolution against this schema shape triggers
// TS2589 ("Type instantiation is excessively deep and possibly infinite") —
// see searchClinicalEvidence.ts for the full explanation. Casting the schema
// to `any` at the tool() call site avoids it; rawInput is cast back to its
// real shape below.
const searchPubMedToolSchema = z.object({
  query: z
    .string()
    .describe('PubMed search query, e.g. "retinol acne treatment efficacy"'),
  maxResults: z
    .number().int().min(1).max(20).optional()
    .describe('Number of results to return (default 10, max 20)'),
  dateFrom:     z.string().optional().describe('Start date filter YYYY/MM/DD'),
  dateTo:       z.string().optional().describe('End date filter YYYY/MM/DD'),
  articleTypes: z
    .array(ArticleTypeEnum).optional()
    .describe('Filter by article type: rct, systematic_review, meta_analysis, clinical_trial'),
  freeFullText: z.boolean().optional().describe('Restrict to free full-text articles only'),
  retstart:     z.number().int().min(0).optional().describe('Pagination offset (0-based)'),
});
type SearchPubMedInput = z.infer<typeof searchPubMedToolSchema>;

export const searchPubMedTool = tool(
  async (rawInput) => {
    const input = rawInput as SearchPubMedInput;
    try {
      const filters: SearchFilters = {
        dateFrom:     input.dateFrom,
        dateTo:       input.dateTo,
        articleTypes: input.articleTypes as ArticleTypeFilter[] | undefined,
        freeFullText: input.freeFullText,
        retstart:     input.retstart,
        maxResults:   input.maxResults ?? 10,
      };

      const { pmids, totalFound } = await searchPmids(input.query, filters);

      return JSON.stringify({
        query:      input.query,
        totalFound,
        returned:   pmids.length,
        pmids,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pubmed] searchPubMed tool failed query="${input.query}"`, err);
      return JSON.stringify({ error: `searchPubMed failed: ${msg}`, query: input.query });
    }
  },
  {
    name: 'searchPubMed',
    description:
      'Search PubMed for peer-reviewed articles and return matching PMIDs. ' +
      'Use getArticleSummary or getArticleAbstract for details, ' +
      'or searchClinicalEvidence for a complete one-shot workflow.',
    schema: searchPubMedToolSchema as any,
  },
);
