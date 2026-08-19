import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TavilySearchResults } from '@langchain/community/tools/tavily_search';

// LangChain's tool() overload resolution against this schema shape triggers
// TS2589 ("Type instantiation is excessively deep and possibly infinite") —
// see searchClinicalEvidence.ts for the full explanation. Casting the schema
// to `any` at the tool() call site avoids it; rawInput is cast back to its
// real shape below.
const webSearchToolSchema = z.object({
  query:   z.string().describe('Natural-language product search query'),
  country: z.string().optional().describe('Country name for availability filtering'),
});
type WebSearchInput = z.infer<typeof webSearchToolSchema>;

export const webSearchTool = tool(
  async (rawInput) => {
    const { query, country } = rawInput as WebSearchInput;
    const tavilyTool = new TavilySearchResults({ maxResults: 10 });
    const countryQuery = country
      ? `${query} available in ${country}`
      : query;
    return tavilyTool.invoke(countryQuery);
  },
  {
    name: 'web_search_products',
    description:
      'Search the web for cosmetic products matching a query. Optionally filtered by country. ' +
      'Always prefer this over the internal catalog.',
    schema: webSearchToolSchema as any,
  },
);
