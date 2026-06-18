/// <reference types="jest" />

import { recommenderAgent } from '../../src/agents/recommender';
import { GraphStateType } from '../../src/graph/state';
import { RecommendedProduct } from '../../src/types';

jest.mock('../../src/llm/client', () => ({
  llmClient: {
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  },
  llmConfig: { model: 'gpt-4o-mini', temperature: 0, max_tokens: 1024 },
}));

const { llmClient } = jest.requireMock('../../src/llm/client') as {
  llmClient: { chat: { completions: { create: jest.Mock } } };
};

const makeProduct = (
  name: string,
  safety: RecommendedProduct['safetyStatus'],
  score: number,
  country = 'UK',
): RecommendedProduct => ({
  name,
  brand: 'B',
  inci: ['glycerin', 'water'],
  categories: [],
  countryAvailability: [country],
  safetyStatus: safety,
  relevanceScore: score,
});

const base: GraphStateType = {
  sessionId:            'sess-1',
  userQuery:            'dry flaky skin',
  queryContext:         { refinedIssue: 'persistent dry patches on cheeks', goals: ['hydrate', 'reduce flaking'] },
  queryReady:           true,
  userProfile:          { country: 'UK', skinType: 'dry', allergies: [] },
  conversationHistory:  [],
  pendingQuestions:     [],
  profileComplete:      true,
  webResults:           [],
  catalogResults:       [],
  safetyCheckedProducts: [
    makeProduct('Cream A', 'safe',    1.0),
    makeProduct('Cream B', 'caution', 0.7),
    makeProduct('Cream C', 'safe',    0.8),
    makeProduct('Cream D', 'unsafe',  0.9),
  ],
  finalRecommendations: [],
  currentStep:          'recommend',
  iterationCount:       3,
  error:                undefined,
};

function mockLlmResponse(names: string[]) {
  llmClient.chat.completions.create.mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          recommendations: names.map(name => ({
            name,
            relevanceToQuery: `${name} is great for dry skin.`,
            reasoning:        `Contains humectants suited to your concern.`,
            usageTips:        ['Apply to damp skin', 'Use twice daily'],
            safetyNotes:      undefined,
          })),
          excludedProducts: [{ name: 'Cream D', reason: 'Unsafe ingredient detected.' }],
        }),
      },
    }],
  });
}

describe('recommenderAgent — LLM path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns at most 5 recommendations', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    expect((result.finalRecommendations ?? []).length).toBeLessThanOrEqual(5);
  });

  it('excludes unsafe products from final recommendations', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const names = (result.finalRecommendations ?? []).map(r => r.name);
    expect(names).not.toContain('Cream D');
  });

  it('ranks safe products above caution products', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const recs = result.finalRecommendations ?? [];
    const firstCautionIndex = recs.findIndex(r => r.safetyStatus === 'caution');
    const lastSafeIndex     = recs.map(r => r.safetyStatus).lastIndexOf('safe');
    if (firstCautionIndex !== -1 && lastSafeIndex !== -1) {
      expect(lastSafeIndex).toBeLessThan(firstCautionIndex);
    }
  });

  it('populates relevanceToQuery from LLM response', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const cream  = result.finalRecommendations?.find(r => r.name === 'Cream A');
    expect(cream?.relevanceToQuery).toBeTruthy();
  });

  it('populates reasoning from LLM response', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const cream  = result.finalRecommendations?.find(r => r.name === 'Cream A');
    expect(cream?.reasoning).toBeTruthy();
  });

  it('populates usageTips as a non-empty array', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const cream  = result.finalRecommendations?.find(r => r.name === 'Cream A');
    expect(Array.isArray(cream?.usageTips)).toBe(true);
    expect((cream?.usageTips ?? []).length).toBeGreaterThan(0);
  });

  it('adds availability notes for matching country', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    const rec = result.finalRecommendations?.find(r => r.countryAvailability.includes('UK'));
    expect(rec?.availabilityNotes).toContain('UK');
  });

  it('sets currentStep to done', async () => {
    mockLlmResponse(['Cream A', 'Cream C', 'Cream B']);
    const result = await recommenderAgent(base);
    expect(result.currentStep).toBe('done');
  });
});

describe('recommenderAgent — fallback path', () => {
  beforeEach(() => {
    llmClient.chat.completions.create.mockRejectedValue(new Error('LLM unavailable'));
  });

  it('still returns recommendations when LLM fails', async () => {
    const result = await recommenderAgent(base);
    expect((result.finalRecommendations ?? []).length).toBeGreaterThan(0);
  });

  it('still excludes unsafe products in fallback mode', async () => {
    const result = await recommenderAgent(base);
    const names = (result.finalRecommendations ?? []).map(r => r.name);
    expect(names).not.toContain('Cream D');
  });

  it('sets currentStep to done in fallback mode', async () => {
    const result = await recommenderAgent(base);
    expect(result.currentStep).toBe('done');
  });

  it('does not populate relevanceToQuery in fallback mode', async () => {
    const result = await recommenderAgent(base);
    const withExplanation = (result.finalRecommendations ?? []).filter(r => r.relevanceToQuery);
    expect(withExplanation).toHaveLength(0);
  });
});
