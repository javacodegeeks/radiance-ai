import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const pgvectorSearchTool = tool(
  async ({ _embedding, _limit = 5, _country }) => {
    // TODO: inject real db pool — avoid top-level import to keep tool testable
    throw new Error('pgvectorSearchTool: database injection not configured. Wire via dependency injection.');
  },
  {
    name: 'catalog_vector_search',
    description:
      'Search the internal product catalog using vector similarity. ' +
      'Use ONLY as a fallback when the web search is unavailable.',
    schema: z.object({
      _embedding: z.array(z.number()).describe('1536-dim query embedding vector'),
      _limit:     z.number().optional().describe('Maximum results to return (default: 5)'),
      _country:   z.string().optional().describe('Filter by country availability'),
    }),
  },
);
