// @ts-ignore — LangChain tool() triggers TS2589 deep generic instantiation
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
export const searchPubMedTool = tool(
  async (input) => {
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
      return JSON.stringify({ error: `searchPubMed failed: ${msg}`, query: input.query });
    }
  },
  {
    name: 'searchPubMed',
    description:
      'Search PubMed for peer-reviewed articles and return matching PMIDs. ' +
      'Use getArticleSummary or getArticleAbstract for details, ' +
      'or searchClinicalEvidence for a complete one-shot workflow.',
    schema: z.object({
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
    }),
  },
);
