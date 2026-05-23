import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const pgvectorSearchTool = tool(
  async ({ embedding, limit = 5, country }) => {
    // TODO: inject real db pool — avoid top-level import to keep tool testable
    throw new Error('pgvectorSearchTool: database injection not configured. Wire via dependency injection.');
  },
  {
    name: 'catalog_vector_search',
    description:
      'Search the internal product catalog using vector similarity. ' +
      'Use ONLY as a fallback when the web search is unavailable.',
    schema: z.object({
      embedding: z.array(z.number()).describe('1536-dim query embedding vector'),
      limit:     z.number().optional().describe('Maximum results to return (default: 5)'),
      country:   z.string().optional().describe('Filter by country availability'),
    }),
  },
);
