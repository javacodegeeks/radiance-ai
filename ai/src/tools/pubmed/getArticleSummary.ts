import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchMetadata } from './pubmedClient';
import { normalizeMetadata } from './normalizer';

/**
 * Low-level MCP tool: fetch structured metadata for one or more PMIDs.
 * Returns title, authors, journal, publication date, and DOI.
 */
// LangChain's tool() overload resolution against this schema shape triggers
// TS2589 ("Type instantiation is excessively deep and possibly infinite") —
// see searchClinicalEvidence.ts for the full explanation. Casting the schema
// to `any` at the tool() call site avoids it; rawInput is cast back to its
// real shape below.
const getArticleSummaryToolSchema = z.object({
  pmids: z
    .union([
      z.string().describe('A single PMID'),
      z.array(z.string()).min(1).max(20).describe('Array of PMIDs (max 20)'),
    ])
    .describe('PubMed ID(s) to retrieve metadata for'),
});
type GetArticleSummaryInput = z.infer<typeof getArticleSummaryToolSchema>;

export const getArticleSummaryTool = tool(
  async (rawInput) => {
    const input = rawInput as GetArticleSummaryInput;
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
    schema: getArticleSummaryToolSchema as any,
  },
);
