jest.mock('../../src/llm/client', () => ({
  chatCompletion: jest.fn(),
  stripJsonFences: (raw: string) => raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
}));

import { chatCompletion } from '../../src/llm/client';
import { recommenderAgent } from '../../src/agents/recommender';
import { GraphStateType } from '../../src/graph/state';
import { RecommendedProduct, Routine } from '../../src/types';

function makeProduct(overrides: Partial<RecommendedProduct>): RecommendedProduct {
  return {
    name: 'Product',
    brand: 'Brand',
    inci: ['Water', 'Glycerin'],
    categories: [],
    countryAvailability: ['US'],
    safetyStatus: 'safe',
    relevanceScore: 0.5,
    ...overrides,
  };
}

function makeState(products: RecommendedProduct[]): GraphStateType {
  return {
    sessionId: 'sess-1',
    userQuery: 'dry sensitive skin',
    queryContext: { refinedIssue: 'dry sensitive skin', goals: ['hydrate'] },
    userProfile: { country: 'US' },
    conversationHistory: [],
    pendingQuestions: [],
    profileComplete: true,
    queryReady: true,
    webResults: [],
    catalogResults: [],
    safetyCheckedProducts: products,
    safetyReport: { approved: [], softWarnings: [], hardBlocks: [] },
    finalRecommendations: [],
    excludedRecommendations: [],
    routine: { am: [], pm: [], interactionWarnings: [] },
    currentStep: 'safety_check',
    iterationCount: 0,
    error: undefined,
  };
}

function successResponse(
  names: string[],
  opts: { excludedProducts?: Array<{ name: string; reason: string }>; routine?: Routine } = {},
): string {
  return JSON.stringify({
    recommendations: names.map(name => ({
      name,
      relevanceToQuery: `Why ${name} helps`,
      reasoning: `Reasoning for ${name}`,
      usageTips: ['Tip 1'],
      confidence: 80,
    })),
    excludedProducts: opts.excludedProducts ?? [],
    routine: opts.routine,
  });
}

describe('recommenderAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('force-includes the best cleanser and moisturizer even when they rank below the top-N by score', async () => {
    const products = [
      makeProduct({ name: 'Treatment A', category: 'treatment', relevanceScore: 0.95 }),
      makeProduct({ name: 'Treatment B', category: 'treatment', relevanceScore: 0.90 }),
      makeProduct({ name: 'Treatment C', category: 'treatment', relevanceScore: 0.85 }),
      makeProduct({ name: 'Treatment D', category: 'treatment', relevanceScore: 0.80 }),
      makeProduct({ name: 'Treatment E', category: 'treatment', relevanceScore: 0.75 }),
      makeProduct({ name: 'Cleanser F', category: 'cleanser', relevanceScore: 0.10 }),
      makeProduct({ name: 'Moisturizer G', category: 'moisturizer', relevanceScore: 0.05 }),
    ];
    (chatCompletion as jest.Mock).mockImplementation(async () =>
      successResponse(['Treatment A', 'Treatment B', 'Treatment C', 'Cleanser F', 'Moisturizer G']),
    );

    const result = await recommenderAgent(makeState(products));

    const names = (result.finalRecommendations ?? []).map(p => p.name);
    expect(names).toHaveLength(5);
    expect(names).toContain('Cleanser F');
    expect(names).toContain('Moisturizer G');
    expect(names).not.toContain('Treatment D');
    expect(names).not.toContain('Treatment E');
  });

  it('falls back to plain score order when no product carries a required category', async () => {
    const products = [
      makeProduct({ name: 'Treatment A', category: 'treatment', relevanceScore: 0.95 }),
      makeProduct({ name: 'Treatment B', category: 'treatment', relevanceScore: 0.90 }),
      makeProduct({ name: 'Treatment C', category: 'treatment', relevanceScore: 0.85 }),
      makeProduct({ name: 'Treatment D', category: 'treatment', relevanceScore: 0.80 }),
      makeProduct({ name: 'Treatment E', category: 'treatment', relevanceScore: 0.75 }),
      makeProduct({ name: 'Treatment F', category: 'treatment', relevanceScore: 0.10 }),
    ];
    (chatCompletion as jest.Mock).mockImplementation(async () =>
      successResponse(['Treatment A', 'Treatment B', 'Treatment C', 'Treatment D', 'Treatment E']),
    );

    const result = await recommenderAgent(makeState(products));

    const names = (result.finalRecommendations ?? []).map(p => p.name);
    expect(names).toHaveLength(5);
    expect(names).not.toContain('Treatment F');
  });

  it('passes the LLM-generated routine through on success', async () => {
    const products = [
      makeProduct({ name: 'Cleanser F', category: 'cleanser' }),
      makeProduct({ name: 'Moisturizer G', category: 'moisturizer' }),
    ];
    const routine: Routine = {
      am: ['Cleanse with Cleanser F', 'Apply Moisturizer G'],
      pm: ['Cleanse with Cleanser F', 'Apply Moisturizer G'],
      interactionWarnings: [],
    };
    (chatCompletion as jest.Mock).mockImplementation(async () =>
      successResponse(['Cleanser F', 'Moisturizer G'], { routine }),
    );

    const result = await recommenderAgent(makeState(products));

    expect(result.routine).toEqual(routine);
    expect(result.currentStep).toBe('done');
  });

  it('merges excludedProducts from the LLM response into excludedRecommendations', async () => {
    const products = [
      makeProduct({ name: 'Safe Product', safetyStatus: 'safe' }),
      makeProduct({ name: 'Unsafe Product', safetyStatus: 'unsafe', safetyNotes: 'contains banned ingredient' }),
    ];
    (chatCompletion as jest.Mock).mockImplementation(async () =>
      successResponse(['Safe Product'], {
        excludedProducts: [{ name: 'Unsafe Product', reason: 'contains banned ingredient' }],
      }),
    );

    const result = await recommenderAgent(makeState(products));

    expect(result.excludedRecommendations).toEqual([
      { name: 'Unsafe Product', reason: 'contains banned ingredient' },
    ]);
  });

  it('falls back to unenriched results and an empty routine when the LLM call fails', async () => {
    const products = [
      makeProduct({ name: 'Safe Product', safetyStatus: 'safe' }),
      makeProduct({ name: 'Unsafe Product', safetyStatus: 'unsafe', safetyNotes: 'contains banned ingredient' }),
    ];
    (chatCompletion as jest.Mock).mockRejectedValue(new Error('LiteLLM unreachable'));

    const result = await recommenderAgent(makeState(products));

    expect((result.finalRecommendations ?? []).map(p => p.name)).toEqual(['Safe Product']);
    expect(result.excludedRecommendations).toEqual([
      { name: 'Unsafe Product', reason: 'contains banned ingredient' },
    ]);
    expect(result.routine).toEqual({ am: [], pm: [], interactionWarnings: [] });
    expect(result.currentStep).toBe('done');
  });

  it('falls back to unenriched results when the LLM response fails schema validation', async () => {
    const products = [makeProduct({ name: 'Safe Product', safetyStatus: 'safe' })];
    (chatCompletion as jest.Mock).mockResolvedValue('not valid json');

    const result = await recommenderAgent(makeState(products));

    expect((result.finalRecommendations ?? []).map(p => p.name)).toEqual(['Safe Product']);
    expect(result.routine).toEqual({ am: [], pm: [], interactionWarnings: [] });
  });
});
