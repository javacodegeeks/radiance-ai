import { questionerAgent } from '../../src/agents/questioner';
import { GraphStateType } from '../../src/graph/state';
import { Message } from '../../src/types';

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'dry flaky skin',
  queryContext: {},
  userProfile: {},
  conversationHistory: [],
  queryReady: true,
  pendingQuestions: [],
  profileComplete: false,
  webResults: [],
  catalogResults: [],
  safetyCheckedProducts: [],
  finalRecommendations: [],
  currentStep: 'interview',
  iterationCount: 0,
  error: undefined,
};

const twoTurns: Message[] = [
  { role: 'user',      content: 'dry skin',   timestamp: new Date() },
  { role: 'assistant', content: 'Got it.',     timestamp: new Date() },
];

describe('questionerAgent', () => {
  it('returns profileComplete=false when critical fields are missing', async () => {
    const result = await questionerAgent(base);
    expect(result.profileComplete).toBe(false);
  });

  it('includes questions for missing critical fields', async () => {
    const result = await questionerAgent(base);
    expect(result.pendingQuestions?.length).toBeGreaterThan(0);
  });

  it('marks profile complete when critical fields present and 2+ turns', async () => {
    const result = await questionerAgent({
      ...base,
      userProfile: { country: 'UK', allergies: [] },
      conversationHistory: twoTurns,
    });
    expect(result.profileComplete).toBe(true);
  });

  it('does not exceed 2 pending questions at a time', async () => {
    const result = await questionerAgent(base);
    expect((result.pendingQuestions ?? []).length).toBeLessThanOrEqual(2);
  });
});
