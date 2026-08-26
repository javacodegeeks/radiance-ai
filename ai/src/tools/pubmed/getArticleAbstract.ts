import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchAbstracts } from './pubmedClient';

/**
 * Low-level MCP tool: fetch parsed abstracts for one or more PMIDs.
 * Returns clean structured text — the LLM never sees raw XML.
 */
// LangChain's tool() overload resolution against this schema shape triggers
// TS2589 ("Type instantiation is excessively deep and possibly infinite") —
// see searchClinicalEvidence.ts for the full explanation. Casting the schema
// to `any` at the tool() call site avoids it; rawInput is cast back to its
// real shape below.
const getArticleAbstractToolSchema = z.object({
  pmids: z
    .union([
      z.string().describe('A single PMID'),
      z.array(z.string()).min(1).max(20).describe('Array of PMIDs (max 20)'),
    ])
    .describe('PubMed ID(s) to retrieve abstracts for'),
});
type GetArticleAbstractInput = z.infer<typeof getArticleAbstractToolSchema>;

export const getArticleAbstractTool = tool(
  async (rawInput) => {
    const input = rawInput as GetArticleAbstractInput;
    try {
      const pmids       = Array.isArray(input.pmids) ? input.pmids : [input.pmids];
      const abstractMap = await fetchAbstracts(pmids);

      const results = pmids.map(pmid => {
        const parsed = abstractMap.get(pmid);
        if (!parsed) return { pmid, abstract: null, articleTypes: [] };
        return {
          pmid,
          abstract:     parsed.abstract,
          articleTypes: parsed.articleTypes,
        };
      });

      return JSON.stringify(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[pubmed] getArticleAbstract tool failed', err);
      return JSON.stringify({ error: `getArticleAbstract failed: ${msg}` });
    }
  },
  {
    name: 'getArticleAbstract',
    description:
      'Retrieve parsed abstracts for one or more PubMed articles by PMID. ' +
      'Abstracts are returned as clean structured text (not raw XML).',
    schema: getArticleAbstractToolSchema as any,
  },
);
