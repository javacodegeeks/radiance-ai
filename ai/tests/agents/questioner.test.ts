/// <reference types="jest" />

import { questionerAgent } from '../../src/agents/questioner';
import { GraphStateType } from '../../src/graph/state';
import { Message } from '../../src/types';

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

const base: GraphStateType = {
  sessionId:            'sess-1',
  userQuery:            'dry flaky skin on my cheeks',
  queryContext:         {},
  queryReady:           false,
  userProfile:          {},
  conversationHistory:  [],
  pendingQuestions:     [],
  profileComplete:      false,
  webResults:           [],
  catalogResults:       [],
  safetyCheckedProducts:[],
  finalRecommendations: [],
  currentStep:          'interview',
  iterationCount:       0,
  error:                undefined,
};

const twoTurns: Message[] = [
  { role: 'user',      content: 'dry flaky skin on my cheeks', timestamp: new Date() },
  { role: 'assistant', content: 'Got it — how long have you had this?', timestamp: new Date() },
];

function mockLlmResponse(partial: object) {
  llmClient.chat.completions.create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(partial) } }],
  });
}

describe('questionerAgent — LLM path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns questions when query and profile are incomplete', async () => {
    mockLlmResponse({
      questions:        ['Which country are you in?', 'Do you have any allergies?'],
      queryRefinement:  { refinedIssue: 'dry flaky skin on cheeks', goals: ['hydrate'] },
      profileUpdates:   {},
      queryReady:       false,
      profileComplete:  false,
    });

    const result = await questionerAgent(base);

    expect(result.pendingQuestions).toHaveLength(2);
    expect(result.profileComplete).toBe(false);
    expect(result.queryReady).toBe(false);
  });

  it('does not exceed 3 pending questions', async () => {
    mockLlmResponse({
      questions:        ['Q1?', 'Q2?', 'Q3?'],
      queryRefinement:  {},
      profileUpdates:   {},
      queryReady:       false,
      profileComplete:  false,
    });

    const result = await questionerAgent(base);
    expect((result.pendingQuestions ?? []).length).toBeLessThanOrEqual(3);
  });

  it('sets queryReady=true when LLM indicates issue is understood', async () => {
    mockLlmResponse({
      questions:       [],
      queryRefinement: {
        refinedIssue: 'persistent dry flaky patches on cheeks',
        bodyArea:     'face',
        severity:     'moderate',
        goals:        ['hydrate', 'reduce flaking'],
      },
      profileUpdates:  { country: 'UK', allergies: [] },
      queryReady:      true,
      profileComplete: true,
    });

    const result = await questionerAgent({ ...base, conversationHistory: twoTurns });

    expect(result.queryReady).toBe(true);
    expect(result.profileComplete).toBe(true);
    expect(result.queryContext?.refinedIssue).toBe('persistent dry flaky patches on cheeks');
    expect(result.queryContext?.bodyArea).toBe('face');
    expect(result.queryContext?.goals).toEqual(['hydrate', 'reduce flaking']);
  });

  it('extracts profile updates from LLM response', async () => {
    mockLlmResponse({
      questions:       ['What is your skin type?'],
      queryRefinement: { refinedIssue: 'dry skin', goals: ['hydrate'] },
      profileUpdates:  { country: 'Germany', allergies: ['fragrance'] },
      queryReady:      false,
      profileComplete: false,
    });

    const result = await questionerAgent(base);

    expect(result.userProfile?.country).toBe('Germany');
    expect(result.userProfile?.allergies).toEqual(['fragrance']);
  });

  it('does not set profileComplete=true if LLM says true but critical fields missing', async () => {
    mockLlmResponse({
      questions:       [],
      queryRefinement: { refinedIssue: 'dry skin', goals: [] },
      profileUpdates:  {},  // no country or allergies provided
      queryReady:      true,
      profileComplete: true, // LLM claims complete — should be overridden
    });

    const result = await questionerAgent(base); // base has no profile

    expect(result.profileComplete).toBe(false);
  });

  it('does not set queryReady=true if refinedIssue is absent', async () => {
    mockLlmResponse({
      questions:       ['Tell me more'],
      queryRefinement: {},  // no refinedIssue
      profileUpdates:  {},
      queryReady:      true, // LLM claims ready — should be overridden
      profileComplete: false,
    });

    const result = await questionerAgent(base);

    expect(result.queryReady).toBe(false);
  });
});

describe('questionerAgent — fallback path', () => {
  beforeEach(() => {
    llmClient.chat.completions.create.mockRejectedValue(new Error('LLM unavailable'));
  });

  it('returns static questions when LLM fails', async () => {
    const result = await questionerAgent(base);
    expect((result.pendingQuestions ?? []).length).toBeGreaterThan(0);
    expect(result.profileComplete).toBe(false);
  });

  it('marks complete via fallback when critical fields present and 2+ turns', async () => {
    const result = await questionerAgent({
      ...base,
      userProfile:         { country: 'UK', allergies: [] },
      conversationHistory: twoTurns,
    });

    expect(result.profileComplete).toBe(true);
    expect(result.queryReady).toBe(true);
  });

  it('does not exceed 2 questions in fallback mode', async () => {
    const result = await questionerAgent(base);
    expect((result.pendingQuestions ?? []).length).toBeLessThanOrEqual(2);
  });
});
