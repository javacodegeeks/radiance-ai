import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TavilySearchResults } from '@langchain/community/tools/tavily_search';

// @ts-ignore — LangChain tool() triggers TS2589 deep generic instantiation
export const webSearchTool = tool(
  async ({ query, country }) => {
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
    schema: z.object({
      query:   z.string().describe('Natural-language product search query'),
      country: z.string().optional().describe('Country name for availability filtering'),
    }),
  },
);
