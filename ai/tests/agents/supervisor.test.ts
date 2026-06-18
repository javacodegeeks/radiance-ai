import { supervisorAgent, routeAfterSupervisor } from '../../src/agents/supervisor';
import { GraphStateType } from '../../src/graph/state';
import { Product, RecommendedProduct } from '../../src/types';

const mockProduct: Product = {
  name: 'Test Cream', brand: 'Brand X', inci: [], categories: [], countryAvailability: [],
};
const mockCheckedProduct: RecommendedProduct = {
  ...mockProduct, safetyStatus: 'safe', relevanceScore: 1,
};

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'dry flaky skin',
  queryContext: {},
  queryReady: false,
  userProfile: {},
  conversationHistory: [],
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

describe('supervisorAgent', () => {
  it('routes to interview when query is ready but profile is incomplete', async () => {
    const result = await supervisorAgent({ ...base, queryReady: true, profileComplete: false });
    expect(result.currentStep).toBe('interview');
  });

  it('routes to catalog_search when profile complete and no catalog results', async () => {
    const result = await supervisorAgent({ ...base, queryReady: true, profileComplete: true });
    expect(result.currentStep).toBe('catalog_search');
  });

  it('routes to web_search when profile complete and no catalog results', async () => {
    const result = await supervisorAgent({ ...base, queryReady: true, profileComplete: true, currentStep: 'catalog_search' });
    expect(result.currentStep).toBe('web_search');
  });

  it('routes to safety_check when catalog results exist but not checked', async () => {
    const result = await supervisorAgent({
      ...base,
      queryReady: true,
      profileComplete: true,
      catalogResults: [mockProduct],
      safetyCheckedProducts: [],
      currentStep: 'catalog_search',
    });
    expect(result.currentStep).toBe('safety_check');
  });

  it('routes to safety_check when web results exist but not checked', async () => {
    const result = await supervisorAgent({
      ...base,
      queryReady: true,
      profileComplete: true,
      webResults: [mockProduct],
      safetyCheckedProducts: [],
      currentStep: 'web_search',
    });
    expect(result.currentStep).toBe('safety_check');
  });

  it('routes to recommend when safety checks done', async () => {
    const result = await supervisorAgent({
      ...base,
      queryReady: true,
      profileComplete: true,
      webResults: [mockProduct],
      safetyCheckedProducts: [mockCheckedProduct],
      currentStep: 'safety_check',
    });
    expect(result.currentStep).toBe('recommend');
  });

  it('stops with error after MAX_ITERATIONS', async () => {
    const result = await supervisorAgent({ ...base, iterationCount: 10 });
    expect(result.currentStep).toBe('error');
    expect(result.error).toMatch(/max iterations/i);
  });

  it('increments iterationCount on each call', async () => {
    const result = await supervisorAgent({ ...base, iterationCount: 3 });
    expect(result.iterationCount).toBe(4);
  });
});

describe('routeAfterSupervisor', () => {
  it('returns the currentStep as the routing key', () => {
    expect(routeAfterSupervisor({ ...base, currentStep: 'catalog_search' })).toBe('catalog_search');
    expect(routeAfterSupervisor({ ...base, currentStep: 'done' })).toBe('done');
  });
});