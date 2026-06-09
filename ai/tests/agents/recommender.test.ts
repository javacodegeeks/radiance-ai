import { recommenderAgent } from '../../src/agents/recommender';
import { GraphStateType } from '../../src/graph/state';
import { RecommendedProduct } from '../../src/types';

const makeProduct = (name: string, safety: RecommendedProduct['safetyStatus'], score: number, country = 'UK'): RecommendedProduct => ({
  name, brand: 'B', inci: [], categories: [], countryAvailability: [country],
  safetyStatus: safety, relevanceScore: score,
});

const base: GraphStateType = {
  sessionId: 'sess-1',
  userQuery: 'dry skin',
  queryContext: { refinedIssue: 'dry skin', goals: [] },
  queryReady: true,
  userProfile: { country: 'UK' },
  conversationHistory: [],
  pendingQuestions: [],
  profileComplete: true,
  webResults: [],
  catalogResults: [],
  safetyCheckedProducts: [
    makeProduct('Cream A', 'safe',    1.0),
    makeProduct('Cream B', 'caution', 0.7),
    makeProduct('Cream C', 'safe',    0.8),
  ],
  finalRecommendations: [],
  currentStep: 'recommend',
  iterationCount: 3,
  error: undefined,
};

describe('recommenderAgent', () => {
  it('returns at most 5 recommendations', async () => {
    const result = await recommenderAgent(base);
    expect((result.finalRecommendations ?? []).length).toBeLessThanOrEqual(5);
  });

  it('ranks safe products above caution products', async () => {
    const result = await recommenderAgent(base);
    const recs = result.finalRecommendations ?? [];
    const firstCautionIndex = recs.findIndex(r => r.safetyStatus === 'caution');
    const lastSafeIndex     = recs.map(r => r.safetyStatus).lastIndexOf('safe');
    if (firstCautionIndex !== -1 && lastSafeIndex !== -1) {
      expect(lastSafeIndex).toBeLessThan(firstCautionIndex);
    }
  });

  it('adds availability notes for matching country', async () => {
    const result = await recommenderAgent(base);
    const rec = result.finalRecommendations?.find(r => r.countryAvailability.includes('UK'));
    expect(rec?.availabilityNotes).toContain('UK');
  });

  it('sets currentStep to done', async () => {
    const result = await recommenderAgent(base);
    expect(result.currentStep).toBe('done');
  });
});