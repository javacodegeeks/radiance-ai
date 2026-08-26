import { supervisorAgent, routeAfterSupervisor } from '../../src/agents/supervisor';
import { GraphStateType } from '../../src/graph/state';

function makeState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    sessionId: 'sess-1',
    userQuery: 'dry skin',
    queryContext: {},
    userProfile: {},
    conversationHistory: [],
    pendingQuestions: [],
    profileComplete: true,
    queryReady: true,
    webResults: [],
    catalogResults: [],
    safetyCheckedProducts: [],
    safetyReport: { approved: [], softWarnings: [], hardBlocks: [] },
    finalRecommendations: [],
    excludedRecommendations: [],
    routine: { am: [], pm: [], interactionWarnings: [] },
    complementaryRecommendations: [],
    currentStep: 'interview',
    iterationCount: 0,
    error: undefined,
    ...overrides,
  };
}

describe('supervisorAgent', () => {
  it('aborts with currentStep=error once iterationCount reaches the max-iteration cap', async () => {
    const result = await supervisorAgent(makeState({ iterationCount: 10 }));

    expect(result.currentStep).toBe('error');
    expect(result.error).toMatch(/max iterations/i);
    // Must not also bump iterationCount further — it should short-circuit immediately.
    expect(result.iterationCount).toBeUndefined();
  });

  it('routes to done when pendingQuestions is non-empty, even if queryReady/profileComplete are also true', async () => {
    const result = await supervisorAgent(makeState({
      pendingQuestions: ['What is your skin type?'],
      queryReady: true,
      profileComplete: true,
    }));

    expect(result.currentStep).toBe('done');
    expect(result.iterationCount).toBe(1);
  });

  it('routes to interview when profile is incomplete, regardless of queryReady', async () => {
    const result = await supervisorAgent(makeState({ queryReady: true, profileComplete: false }));

    expect(result.currentStep).toBe('interview');
  });

  it('routes to interview when the query is not yet ready, regardless of profileComplete', async () => {
    const result = await supervisorAgent(makeState({ queryReady: false, profileComplete: true }));

    expect(result.currentStep).toBe('interview');
  });

  it('routes to catalog_search after the interview step when no catalog results exist yet', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'interview',
      queryReady: true,
      profileComplete: true,
      catalogResults: [],
    }));

    expect(result.currentStep).toBe('catalog_search');
  });

  it('routes to web_search when catalog_search came back with zero results', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'catalog_search',
      catalogResults: [],
    }));

    expect(result.currentStep).toBe('web_search');
  });

  it('routes to safety_check once products are found and it has not already run', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'catalog_search',
      catalogResults: [{ name: 'A', brand: 'B', inci: [], categories: [], countryAvailability: [] }],
      safetyCheckedProducts: [],
    }));

    expect(result.currentStep).toBe('safety_check');
  });

  it('proceeds to safety_check even when web_search found nothing — prevents an infinite catalog/web loop', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'web_search',
      catalogResults: [],
      safetyCheckedProducts: [],
    }));

    expect(result.currentStep).toBe('safety_check');
  });

  it('routes to recommend once safety-checked products exist and no recommendations have been made yet', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'safety_check',
      safetyCheckedProducts: [{ name: 'A', brand: 'B', inci: [], categories: [], countryAvailability: [], safetyStatus: 'safe', relevanceScore: 1 }],
      finalRecommendations: [],
    }));

    expect(result.currentStep).toBe('recommend');
  });

  it('does not loop back into safety_check a second time even if safetyCheckedProducts is still empty', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'safety_check',
      safetyCheckedProducts: [],
      finalRecommendations: [],
    }));

    expect(result.currentStep).toBe('recommend');
  });

  it('routes to done once finalRecommendations has been populated', async () => {
    const result = await supervisorAgent(makeState({
      currentStep: 'recommend',
      safetyCheckedProducts: [{ name: 'A', brand: 'B', inci: [], categories: [], countryAvailability: [], safetyStatus: 'safe', relevanceScore: 1 }],
      finalRecommendations: [{ name: 'A', brand: 'B', inci: [], categories: [], countryAvailability: [], safetyStatus: 'safe', relevanceScore: 1 }],
    }));

    expect(result.currentStep).toBe('done');
  });

  it('increments iterationCount by exactly 1 on every non-aborting call', async () => {
    const result = await supervisorAgent(makeState({ iterationCount: 3 }));
    expect(result.iterationCount).toBe(4);
  });
});

describe('routeAfterSupervisor', () => {
  it('returns the state currentStep verbatim as the conditional-edge target', () => {
    expect(routeAfterSupervisor(makeState({ currentStep: 'web_search' }))).toBe('web_search');
  });
});
