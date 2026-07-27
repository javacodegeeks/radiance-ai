// @ts-ignore — LangChain tool() triggers TS2589 deep generic instantiation
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchMetadata } from './pubmedClient';
import { normalizeMetadata } from './normalizer';

/**
 * Low-level MCP tool: fetch structured metadata for one or more PMIDs.
 * Returns title, authors, journal, publication date, and DOI.
 */
export const getArticleSummaryTool = tool(
  async (input) => {
    try {
      const pmids   = Array.isArray(input.pmids) ? input.pmids : [input.pmids];
      const metaMap = await fetchMetadata(pmids);

      const results = pmids.map((pmid, idx) => {
        const doc = metaMap.get(pmid);
        if (!doc) return { pmid, error: 'Article not found in PubMed' };
        return normalizeMetadata(doc, idx, pmids.length);
      });

      return JSON.stringify(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[pubmed] getArticleSummary tool failed', err);
      return JSON.stringify({ error: `getArticleSummary failed: ${msg}` });
    }
  },
  {
    name: 'getArticleSummary',
    description:
      'Retrieve structured metadata (title, authors, journal, date, DOI) for one or more ' +
      'PubMed articles by PMID. Use searchPubMed first to obtain PMIDs.',
    schema: z.object({
      pmids: z
        .union([
          z.string().describe('A single PMID'),
          z.array(z.string()).min(1).max(20).describe('Array of PMIDs (max 20)'),
        ])
        .describe('PubMed ID(s) to retrieve metadata for'),
    }),
  },
);
