/// <reference types="jest" />

import { GraphStateType } from '../../src/graph/state';
import { webResearcherAgent } from '../../src/agents/webResearcher';

jest.mock('@langchain/tavily', () => {
  return {
    TavilySearch: jest.fn(),
  };
});

jest.mock('../../src/llm/client', () => ({
  llmClient: {
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  },
  llmConfig: {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 2048,
  },
}));

const { TavilySearch: TavilySearchMock } = jest.requireMock('@langchain/tavily') as {
  TavilySearch: jest.Mock;
};
const { llmClient } = jest.requireMock('../../src/llm/client') as {
  llmClient: {
    chat: {
      completions: {
        create: jest.Mock;
      };
    };
  };
};

let invokeMock: jest.Mock;

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'night moisturizer',
  queryContext: {},
  userProfile: { country: 'UK' },
  conversationHistory: [],
  queryReady: true,
  pendingQuestions: [],
  profileComplete: true,
  webResults: [],
  catalogResults: [],
  safetyCheckedProducts: [],
  finalRecommendations: [],
  currentStep: 'research',
  iterationCount: 0,
  error: undefined,
};

describe('webResearcherAgent', () => {

  beforeEach(() => {
    invokeMock = jest.fn();
    TavilySearchMock.mockClear();
    TavilySearchMock.mockImplementation(() => ({ invoke: invokeMock }));
    llmClient.chat.completions.create.mockClear();
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'Unknown' } }],
    });
  });

  it('returns parsed web results for successful search responses', async () => {
    invokeMock.mockResolvedValue(
      JSON.stringify([
        {
          title: 'Hydrating Night Cream',
          url: 'https://example.com/night-cream',
          content: 'A nourishing formulation by BrandX',
        },
      ]),
    );
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'BrandX' } }],
    });

    const result = await webResearcherAgent(base);

    expect(TavilySearchMock).toHaveBeenCalledWith({ maxResults: 10 });
    expect(invokeMock).toHaveBeenCalledWith({
      query: 'cosmetic skincare products for night moisturizer site:.co.uk OR "available in UK"',
    });
    expect(result.webResults).toHaveLength(1);
    expect(result.webResults?.[0]).toMatchObject({
      name: 'Hydrating Night Cream',
      brand: 'BrandX',
      sourceUrl: 'https://example.com/night-cream',
      countryAvailability: ['UK'],
    });
    expect(result.webResults?.[0].cachedAt).toBeInstanceOf(Date);
  });

  it('builds a query without country-specific operators when country is absent', async () => {
    invokeMock.mockResolvedValue(
      JSON.stringify([
        { title: 'Moisture Gel', url: 'https://example.com/moisture-gel', content: '' },
      ]),
    );

    const result = await webResearcherAgent({
      ...base,
      userProfile: {},
    });

    expect(invokeMock).toHaveBeenCalledWith({
      query: 'cosmetic skincare products for night moisturizer',
    });
    expect(result.webResults?.[0].name).toBe('Moisture Gel');
  });

  it('returns empty webResults when the search tool throws an error', async () => {
    invokeMock.mockRejectedValue(new Error('network failure'));

    const result = await webResearcherAgent(base);

    expect(result.webResults).toEqual([]);
  });
});
