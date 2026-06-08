import { safetyCheckerAgent } from '../../src/agents/safetyChecker';
import { setRulesProvider } from '../../src/tools/safetyRulesLookup';
import { GraphStateType } from '../../src/graph/state';
import { Product, SafetyRule } from '../../src/types';

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'dry skin',
  queryContext: { refinedIssue: 'dry skin', goals: [] },
  queryReady: true,
  userProfile: { allergies: ['fragrance_sensitivity'] },
  conversationHistory: [],
  pendingQuestions: [],
  profileComplete: true,
  webResults: [],
  catalogResults: [],
  safetyCheckedProducts: [],
  finalRecommendations: [],
  currentStep: 'safety_check',
  iterationCount: 1,
  error: undefined,
};

const safeProduct: Product = {
  name: 'Gentle Cream', brand: 'A', inci: ['water', 'glycerin'], categories: [], countryAvailability: [],
};
const dangerousProduct: Product = {
  name: 'Fragrant Lotion', brand: 'B', inci: ['fragrance', 'water'], categories: [], countryAvailability: [],
};
const unknownInciProduct: Product = {
  name: 'Mystery Serum', brand: 'C', inci: [], categories: [], countryAvailability: [],
};

beforeEach(() => {
  setRulesProvider(async (ings, conds) => {
    const critical: SafetyRule = { id: '1', ingredient: 'fragrance', contraindication: 'fragrance_sensitivity', severity: 'high' };
    return ings.includes('fragrance') && conds.includes('fragrance_sensitivity') ? [critical] : [];
  });
});

describe('safetyCheckerAgent', () => {
  it('marks product as safe when no violations found', async () => {
    const result = await safetyCheckerAgent({ ...base, webResults: [safeProduct] });
    expect(result.safetyCheckedProducts?.[0].safetyStatus).toBe('safe');
  });

  it('marks product as unsafe when critical/high violation found', async () => {
    const result = await safetyCheckerAgent({ ...base, webResults: [dangerousProduct] });
    expect(result.safetyCheckedProducts).toHaveLength(0); // unsafe products filtered out
  });

  it('marks product as caution when INCI list is missing', async () => {
    const result = await safetyCheckerAgent({ ...base, webResults: [unknownInciProduct] });
    expect(result.safetyCheckedProducts?.[0].safetyStatus).toBe('caution');
  });

  it('combines webResults and catalogResults', async () => {
    const result = await safetyCheckerAgent({
      ...base,
      webResults:     [safeProduct],
      catalogResults: [unknownInciProduct],
    });
    expect(result.safetyCheckedProducts).toHaveLength(2);
  });
});