/// <reference types="jest" />

import { GraphStateType } from '../../src/graph/state';
import { ProductDocument } from '../../../data/src/repositories/productRepository';

let productFinderAgent: (state: GraphStateType) => Promise<Partial<GraphStateType>>;
let findSimilarMock: jest.Mock;
let generateEmbedding: jest.Mock;
let llmClient: {
  chat: {
    completions: {
      create: jest.Mock;
    };
  };
};
let ProductRepository: jest.Mock;

jest.mock('../../../data/src/repositories/productRepository', () => {
  return {
    ProductRepository: jest.fn().mockImplementation(() => ({
      findSimilar: jest.fn(),
    })),
  };
});

jest.mock('../../../data/src/qdrant', () => ({
  generateEmbedding: jest.fn(),
}));

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

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'dry skin with redness',
  queryContext: { refinedIssue: 'dry skin with redness', goals: ['hydrate', 'soothe'] },
  queryReady: true,
  userProfile: { country: 'US' },
  conversationHistory: [],
  pendingQuestions: [],
  profileComplete: true,
  webResults: [],
  catalogResults: [],
  safetyCheckedProducts: [],
  finalRecommendations: [],
  currentStep: 'catalog_search',
  iterationCount: 0,
  error: undefined,
};

const mockProductDocument: ProductDocument = {
  _id: '507f1f77bcf86cd799439011',
  product_name: 'Hydrating Repair Cream',
  product_name_en: 'Hydrating Repair Cream',
  brands: 'CeraVe',
  categories: ['skincare', 'moisturizer'],
  countries: ['US', 'CA'],
  ingredients: ['water', 'glycerin', 'ceramide'],
  ingredients_text_en: 'Water, Glycerin, Ceramide',
  cached_at: new Date('2025-06-11'),
};

const mockProductDocumentMinimal: ProductDocument = {
  _id: '507f1f77bcf86cd799439012',
  brands: 'Unknown Brand',
  categories: [],
  ingredients: [],
};

const mockSensitiveProduct: ProductDocument = {
    _id: '507f1f77bcf86cd799439013',
    product_name: 'Sensitive Skin Moisturizer',
    brands: 'Cetaphil',
    categories: ['moisturizer', 'sensitive'],
    countries: ['US'],
    ingredients: ['water', 'glycerin', 'panthenol', 'sodium hyaluronate'],
    cached_at: new Date(),
};

describe('productFinderAgent', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    findSimilarMock = jest.fn();
    ProductRepository = jest.requireMock(
      '../../../data/src/repositories/productRepository',
    ).ProductRepository as jest.Mock;
    ProductRepository.mockImplementation(() => ({
      findSimilar: findSimilarMock,
    }));

    generateEmbedding = jest.requireMock(
      '../../../data/src/qdrant',
    ).generateEmbedding as jest.Mock;

    llmClient = jest.requireMock('../../src/llm/client').llmClient as {
      chat: {
        completions: {
          create: jest.Mock;
        };
      };
    };

    productFinderAgent = require('../../src/agents/productFinder').productFinderAgent;

    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'glycerin, ceramide, hyaluronic acid' } }],
    });
    generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('returns parsed catalog results for successful search', async () => {
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toHaveLength(1);
    expect(result.catalogResults?.[0]).toMatchObject({
      name: 'Hydrating Repair Cream',
      brand: 'CeraVe',
      inci: ['water', 'glycerin', 'ceramide'],
      categories: ['skincare', 'moisturizer'],
      countryAvailability: ['US', 'CA'],
    });
  });

  it('calls findSimilar with correct parameters', async () => {
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(base);

    expect(generateEmbedding).toHaveBeenCalled();
    expect(findSimilarMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      10,
      'US',
    );
  });

  it('builds query with LLM-suggested ingredients', async () => {
    findSimilarMock.mockResolvedValue([mockProductDocument]);
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'glycerin, ceramide' } }],
    });

    await productFinderAgent(base);

    expect(llmClient.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      temperature: 0.0,
      max_tokens: 150,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('cosmetics ingredient'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('dry skin with redness'),
        }),
      ]),
    });

    const callArgs = generateEmbedding.mock.calls[0][0];
    expect(callArgs).toContain('glycerin, ceramide');
  });

  it('returns empty results when search fails', async () => {
    findSimilarMock.mockRejectedValue(new Error('Qdrant connection failed'));

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toEqual([]);
  });

  it('returns empty results when embedding generation fails', async () => {
    generateEmbedding.mockRejectedValue(new Error('Embedding service down'));

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toEqual([]);
  });

  it('handles LLM errors gracefully and continues without ingredients', async () => {
    llmClient.chat.completions.create.mockRejectedValue(new Error('LLM service error'));
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toHaveLength(1);
  });

  it('parses multiple product results correctly', async () => {
    const docs = [mockProductDocument, mockProductDocumentMinimal];
    findSimilarMock.mockResolvedValue(docs);

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toHaveLength(2);
    expect(result.catalogResults?.[1]).toMatchObject({
      name: 'Unknown Product',
      brand: 'Unknown Brand',
      inci: [],
      categories: [],
      countryAvailability: [],
    });
  });

  it('handles product with product_name_en fallback when product_name is missing', async () => {
    const docWithFallback: ProductDocument = {
      ...mockProductDocument,
      product_name: undefined,
    };
    findSimilarMock.mockResolvedValue([docWithFallback]);

    const result = await productFinderAgent(base);

    expect(result.catalogResults?.[0].name).toBe('Hydrating Repair Cream');
  });

  it('uses refined issue from query context when available', async () => {
    const stateWithContext: GraphStateType = {
      ...base,
      userQuery: 'generic query',
      queryContext: { refinedIssue: 'persistent dry skin patches', goals: [] },
    };
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(stateWithContext);

    const embeddingCallArg = generateEmbedding.mock.calls[0][0];
    expect(embeddingCallArg).toContain('persistent dry skin patches');
  });

  it('handles undefined country in user profile', async () => {
    const stateWithoutCountry: GraphStateType = {
      ...base,
      userProfile: {},
    };
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(stateWithoutCountry);

    expect(findSimilarMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      10,
      undefined,
    );
  });

  it('returns empty results and handles null/undefined response structures', async () => {
    llmClient.chat.completions.create.mockResolvedValue(null);
    generateEmbedding.mockResolvedValue([0.1, 0.2]);
    findSimilarMock.mockResolvedValue([]);

    const result = await productFinderAgent(base);

    expect(result.catalogResults).toEqual([]);
  });

  it('filters out "Unknown" and similar responses from ingredient search', async () => {
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'Unknown' } }],
    });
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(base);

    const embeddingCall = generateEmbedding.mock.calls[0][0];
    expect(embeddingCall).not.toContain('Unknown');
    expect(embeddingCall).toContain('dry skin with redness');
  });

  it('filters out responses indicating no ingredients can be determined', async () => {
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'unable to determine suitable ingredients' } }],
    });
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(base);

    const embeddingCall = generateEmbedding.mock.calls[0][0];
    expect(embeddingCall).not.toContain('unable to determine');
  });

  it('handles ingredient response with quoted strings', async () => {
    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '"glycerin, hyaluronic acid"' } }],
    });
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(base);

    const embeddingCall = generateEmbedding.mock.calls[0][0];
    expect(embeddingCall).toContain('glycerin, hyaluronic acid');
  });

  it('handles empty query context refinedIssue gracefully', async () => {
    const stateWithEmptyContext: GraphStateType = {
      ...base,
      queryContext: { refinedIssue: '', goals: [] },
    };
    findSimilarMock.mockResolvedValue([mockProductDocument]);

    await productFinderAgent(stateWithEmptyContext);

    expect(generateEmbedding).toHaveBeenCalled();
  });

  it('preserves cached_at timestamp from product document', async () => {
    const timestamp = new Date('2025-06-10T12:00:00Z');
    const docWithTimestamp: ProductDocument = {
      ...mockProductDocument,
      cached_at: timestamp,
    };
    findSimilarMock.mockResolvedValue([docWithTimestamp]);

    const result = await productFinderAgent(base);

    expect(result.catalogResults?.[0].cachedAt).toEqual(timestamp);
  });

  it('respects MAX_RESULTS limit in repository call', async () => {
    const largeResultSet = Array(15).fill(mockProductDocument);
    findSimilarMock.mockResolvedValue(largeResultSet.slice(0, 10));

    await productFinderAgent(base);

    expect(findSimilarMock).toHaveBeenCalledWith(
      expect.any(Array),
      10,
      expect.anything(),
    );
  });

  it('extracts ingredient list from chatty LLM response', async () => {
    // Mock a verbose LLM response with embedded ingredient list
    const chattyChattyResponse =
      'For a moisturizer suitable for sensitive skin, I recommend the following ingredients:\n\n' +
      'Aloe barbadensis leaf juice, Glycerin, Panthenol, Cetearyl olivate, Sorbitan olivate, Tocopherol, ' +
      'Xylitylglucoside, Anhydroxylitol, Sodium hyaluronate, Avena sativa kernel oil, Oenothera biennis oil, ' +
      'and Phenoxyethanol (at a low concentration).\n\n' +
      'These ingredients provide moisturization, soothing, and anti-inflammatory properties, ' +
      'making them suitable for sensitive skin.';

    llmClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: chattyChattyResponse } }],
    });

    findSimilarMock.mockResolvedValue([mockSensitiveProduct]);

    const result = await productFinderAgent(base);

    // Verify products were found
    expect(result.catalogResults).toHaveLength(1);
    expect(result.catalogResults?.[0].name).toBe('Sensitive Skin Moisturizer');

    // Verify the embedding call included the extracted ingredient list
    const embeddingCall = generateEmbedding.mock.calls[0][0];
    expect(embeddingCall).toContain('Aloe barbadensis leaf juice');
    expect(embeddingCall).toContain('Glycerin');
    expect(embeddingCall).toContain('Sodium hyaluronate');
    expect(embeddingCall).not.toContain('These ingredients provide');
  });
});
