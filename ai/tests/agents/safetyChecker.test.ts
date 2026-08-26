jest.mock('../../src/llm/client', () => ({
  chatCompletion: jest.fn(),
  stripJsonFences: (raw: string) => raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
}));

jest.mock('../../src/repositories/safetyRulesRepository', () => ({
  findSafetyViolations: jest.fn(),
  getKnownContraindications: jest.fn(),
}));

jest.mock('../../src/repositories/cosingRestrictionsRepository', () => ({
  findCosingRestrictions: jest.fn(),
  findProhibitedSubstances: jest.fn(),
}));

import { chatCompletion } from '../../src/llm/client';
import { findSafetyViolations, getKnownContraindications } from '../../src/repositories/safetyRulesRepository';
import { findCosingRestrictions, findProhibitedSubstances } from '../../src/repositories/cosingRestrictionsRepository';
import { assessProductLayer1, checkProductSafety, safetyCheckerAgent } from '../../src/agents/safetyChecker';
import { GraphStateType } from '../../src/graph/state';
import { Product, SafetyRule, CosingRestriction, CosingProhibitedSubstance } from '../../src/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    name: 'Product A',
    brand: 'Brand A',
    inci: ['Water', 'Glycerin', 'Niacinamide', 'Panthenol', 'Ceramide NP'],
    categories: [],
    countryAvailability: ['US'],
    ...overrides,
  };
}

function makeState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    sessionId: 'sess-1',
    userQuery: 'dry sensitive skin',
    queryContext: { refinedIssue: 'dry sensitive skin', goals: [] },
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
    currentStep: 'safety_check',
    iterationCount: 0,
    error: undefined,
    ...overrides,
  };
}

const noViolations: SafetyRule[] = [];
const noRestrictions: CosingRestriction[] = [];
const noProhibited: CosingProhibitedSubstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  (findSafetyViolations as jest.Mock).mockResolvedValue(noViolations);
  (findCosingRestrictions as jest.Mock).mockResolvedValue(noRestrictions);
  (findProhibitedSubstances as jest.Mock).mockResolvedValue(noProhibited);
  (getKnownContraindications as jest.Mock).mockResolvedValue(new Set(['fragrance']));
});

describe('assessProductLayer1', () => {
  it('hard-blocks on an EU CosIng Annex II prohibited substance, regardless of the allergy-based violation lookup', async () => {
    (findProhibitedSubstances as jest.Mock).mockResolvedValue([
      { id: '1', ingredient: 'hydroquinone', referenceNumber: '1234' } as CosingProhibitedSubstance,
    ]);

    const result = await assessProductLayer1(makeProduct(), [], false);

    expect(result.kind).toBe('hard_block');
    if (result.kind === 'hard_block') {
      expect(result.notes).toMatch(/prohibited in cosmetic products under EU law/);
    }
  });

  it('hard-blocks on a critical or high severity safety_rules violation', async () => {
    (findSafetyViolations as jest.Mock).mockResolvedValue([
      { id: '1', ingredient: 'retinol', contraindication: 'pregnancy', severity: 'high', notes: 'Avoid during pregnancy.' },
    ]);

    const result = await assessProductLayer1(makeProduct(), ['pregnancy'], false);

    expect(result.kind).toBe('hard_block');
    if (result.kind === 'hard_block') {
      expect(result.notes).toBe('Avoid during pregnancy.');
    }
  });

  it('returns an immediate soft warning when the product has no ingredient signals at all', async () => {
    const product = makeProduct({ inci: [], allergens: undefined });

    const result = await assessProductLayer1(product, [], false);

    expect(result.kind).toBe('immediate_soft_warning');
    expect(findSafetyViolations).not.toHaveBeenCalled();
  });

  it('defaults to caution when the safety_rules lookup throws', async () => {
    (findSafetyViolations as jest.Mock).mockRejectedValue(new Error('db down'));

    const result = await assessProductLayer1(makeProduct(), ['fragrance'], false);

    expect(result.kind).toBe('immediate_soft_warning');
  });

  it('clears a product with a clean lookup, sufficient ingredient data, and no unrecognized conditions', async () => {
    const result = await assessProductLayer1(makeProduct(), [], false);

    expect(result.kind).toBe('clear');
  });

  it('flags sparse ingredient data below the minimum reliable ingredient count', async () => {
    const product = makeProduct({ inci: ['Water', 'Glycerin'] });

    const result = await assessProductLayer1(product, [], false);

    expect(result.kind).toBe('flagged');
    if (result.kind === 'flagged') {
      expect(result.reason).toContain('sparse_ingredient_data');
    }
  });

  it('flags an unrecognized condition even when the deterministic lookups come back clean', async () => {
    const result = await assessProductLayer1(makeProduct(), ['unmapped_condition'], true);

    expect(result.kind).toBe('flagged');
    if (result.kind === 'flagged') {
      expect(result.reason).toContain('unrecognized_condition');
    }
  });

  it('flags an EU CosIng Annex III/IV/V usage restriction as a general caution signal', async () => {
    (findCosingRestrictions as jest.Mock).mockResolvedValue([
      { id: '1', ingredient: 'salicylic acid', annex: 'III', referenceNumber: '98', maxConcentration: '2%' } as CosingRestriction,
    ]);

    const result = await assessProductLayer1(makeProduct(), [], false);

    expect(result.kind).toBe('flagged');
    if (result.kind === 'flagged') {
      expect(result.reason).toContain('cosing_restriction');
      expect(result.notes).toMatch(/CosIng Annex III #98/);
    }
  });

  it('flags a lower-severity (medium/low) violation instead of hard-blocking it', async () => {
    (findSafetyViolations as jest.Mock).mockResolvedValue([
      { id: '1', ingredient: 'fragrance', contraindication: 'fragrance', severity: 'medium', notes: 'May irritate sensitive skin.' },
    ]);

    const result = await assessProductLayer1(makeProduct(), ['fragrance'], false);

    expect(result.kind).toBe('flagged');
    if (result.kind === 'flagged') {
      expect(result.reason).toContain('lower_severity_violation');
    }
  });
});

describe('checkProductSafety (Layer-1-only entry point used by recommender.ts)', () => {
  it('maps a hard block to safetyStatus=unsafe with relevanceScore 0', async () => {
    (findProhibitedSubstances as jest.Mock).mockResolvedValue([
      { id: '1', ingredient: 'hydroquinone', referenceNumber: '1234' } as CosingProhibitedSubstance,
    ]);

    const result = await checkProductSafety(makeProduct(), []);

    expect(result.safetyStatus).toBe('unsafe');
    expect(result.relevanceScore).toBe(0);
  });

  it('maps a flagged Layer 1 signal directly to caution, without ever calling the Layer 2 LLM', async () => {
    const product = makeProduct({ inci: ['Water', 'Glycerin'] }); // sparse

    const result = await checkProductSafety(product, []);

    expect(result.safetyStatus).toBe('caution');
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('maps a clear product to safe with full relevance', async () => {
    const result = await checkProductSafety(makeProduct(), []);

    expect(result.safetyStatus).toBe('safe');
    expect(result.relevanceScore).toBe(1.0);
  });
});

describe('safetyCheckerAgent', () => {
  it('buckets a clean product into approved and a hard-blocked product into hardBlocks without invoking Layer 2', async () => {
    (findProhibitedSubstances as jest.Mock)
      .mockResolvedValueOnce([]) // clean product
      .mockResolvedValueOnce([{ id: '1', ingredient: 'hydroquinone', referenceNumber: '1' } as CosingProhibitedSubstance]); // unsafe product

    const state = makeState({
      catalogResults: [makeProduct({ name: 'Clean Product' }), makeProduct({ name: 'Unsafe Product' })],
    });

    const result = await safetyCheckerAgent(state);

    expect(result.safetyReport?.approved.map(p => p.name)).toEqual(['Clean Product']);
    expect(result.safetyReport?.hardBlocks.map(p => p.name)).toEqual(['Unsafe Product']);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("resolves a flagged product to approved when Layer 2 clears it, and Layer 2's reasoning cannot escalate it to a hard block", async () => {
    const sparseProduct = makeProduct({ name: 'Sparse Product', inci: ['Water'] });
    (chatCompletion as jest.Mock).mockResolvedValue(JSON.stringify({
      assessments: [{ name: 'Sparse Product', verdict: 'approved', reasoning: 'Sparse but ingredients are all benign.' }],
    }));

    const result = await safetyCheckerAgent(makeState({ catalogResults: [sparseProduct] }));

    expect(result.safetyReport?.approved.map(p => p.name)).toEqual(['Sparse Product']);
    expect(result.safetyReport?.hardBlocks).toEqual([]);
  });

  it('favors caution (soft_warning) when the Layer 2 LLM call fails outright', async () => {
    const sparseProduct = makeProduct({ name: 'Sparse Product', inci: ['Water'] });
    (chatCompletion as jest.Mock).mockRejectedValue(new Error('LiteLLM unreachable'));

    const result = await safetyCheckerAgent(makeState({ catalogResults: [sparseProduct] }));

    expect(result.safetyReport?.softWarnings.map(p => p.name)).toEqual(['Sparse Product']);
    expect(result.safetyReport?.approved).toEqual([]);
  });

  it('favors caution when the Layer 2 response fails schema validation', async () => {
    const sparseProduct = makeProduct({ name: 'Sparse Product', inci: ['Water'] });
    (chatCompletion as jest.Mock).mockResolvedValue('not valid json');

    const result = await safetyCheckerAgent(makeState({ catalogResults: [sparseProduct] }));

    expect(result.safetyReport?.softWarnings.map(p => p.name)).toEqual(['Sparse Product']);
  });

  it('favors caution when a Layer 2 assessment name does not match any flagged product', async () => {
    const sparseProduct = makeProduct({ name: 'Sparse Product', inci: ['Water'] });
    (chatCompletion as jest.Mock).mockResolvedValue(JSON.stringify({
      assessments: [{ name: 'A Totally Different Product', verdict: 'approved', reasoning: 'n/a' }],
    }));

    const result = await safetyCheckerAgent(makeState({ catalogResults: [sparseProduct] }));

    expect(result.safetyReport?.softWarnings.map(p => p.name)).toEqual(['Sparse Product']);
    expect(result.safetyReport?.approved).toEqual([]);
  });

  it('defaults hasUnrecognizedConditions to true (favoring caution) when the known-tags lookup fails', async () => {
    (getKnownContraindications as jest.Mock).mockRejectedValue(new Error('db down'));
    (chatCompletion as jest.Mock).mockResolvedValue(JSON.stringify({ assessments: [] }));

    const result = await safetyCheckerAgent(makeState({
      catalogResults: [makeProduct({ name: 'Clean Product' })],
      userProfile: { allergies: ['some_allergy'] },
    }));

    // The unrecognized-condition signal alone is enough to move an otherwise
    // clean product out of the 'clear' bucket and into Layer 2 (here defaulted
    // to soft_warning since chatCompletion is unmocked-success in this test).
    expect(result.safetyReport?.approved).toEqual([]);
    expect(
      [...(result.safetyReport?.softWarnings ?? [])].map(p => p.name),
    ).toEqual(['Clean Product']);
  });
});
