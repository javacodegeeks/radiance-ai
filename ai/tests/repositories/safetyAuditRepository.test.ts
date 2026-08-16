jest.mock('../../src/infra/mongo', () => ({
  getDb: jest.fn(),
}));

import { getDb } from '../../src/infra/mongo';
import { recordSafetyAudit } from '../../src/repositories/safetyAuditRepository';
import { RecommendedProduct } from '../../src/types';

function product(overrides: Partial<RecommendedProduct> = {}): RecommendedProduct {
  return {
    name: 'Product A',
    brand: 'Brand A',
    inci: [],
    safetyStatus: 'unsafe',
    relevanceScore: 0,
    ...overrides,
  } as RecommendedProduct;
}

describe('recordSafetyAudit', () => {
  const mockInsertOne = jest.fn();
  const mockCollection = jest.fn(() => ({ insertOne: mockInsertOne }));

  beforeEach(() => {
    jest.clearAllMocks();
    (getDb as jest.Mock).mockResolvedValue({ collection: mockCollection });
  });

  it('inserts a lean audit record keyed by sessionId with each bucket mapped to name/brand/safetyStatus/safetyNotes', async () => {
    const at = new Date('2026-08-15T00:00:00Z');

    await recordSafetyAudit({
      sessionId: 'sess-1',
      hardBlocks: [product({ name: 'Retinol Cream', brand: 'Acme', safetyStatus: 'unsafe', safetyNotes: 'Contains prohibited substance X.' })],
      softWarnings: [product({ name: 'Fragrance Lotion', brand: 'Acme', safetyStatus: 'caution', safetyNotes: 'EU-regulated ingredient.' })],
      approved: [product({ name: 'Plain Moisturizer', brand: 'Acme', safetyStatus: 'safe' })],
      excludedRecommendations: [{ name: 'Retinol Cream', reason: 'Contains prohibited substance X.' }],
      at,
    });

    expect(mockCollection).toHaveBeenCalledWith('safety_audit_log');
    expect(mockInsertOne).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      hardBlocks: [{ name: 'Retinol Cream', brand: 'Acme', safetyStatus: 'unsafe', safetyNotes: 'Contains prohibited substance X.' }],
      softWarnings: [{ name: 'Fragrance Lotion', brand: 'Acme', safetyStatus: 'caution', safetyNotes: 'EU-regulated ingredient.' }],
      approved: [{ name: 'Plain Moisturizer', brand: 'Acme', safetyStatus: 'safe' }],
      excludedRecommendations: [{ name: 'Retinol Cream', reason: 'Contains prohibited substance X.' }],
      createdAt: at,
    });
  });

  it('omits safetyNotes entirely when a product has none', async () => {
    await recordSafetyAudit({
      sessionId: 'sess-1',
      hardBlocks: [],
      softWarnings: [],
      approved: [product({ name: 'Plain Moisturizer', safetyStatus: 'safe' })],
      excludedRecommendations: [],
      at: new Date(),
    });

    const inserted = mockInsertOne.mock.calls[0][0];
    expect(inserted.approved[0]).not.toHaveProperty('safetyNotes');
  });

  it('throws a RepositoryError when the insert fails', async () => {
    mockInsertOne.mockRejectedValue(new Error('connection lost'));

    await expect(recordSafetyAudit({
      sessionId: 'sess-1', hardBlocks: [], softWarnings: [], approved: [], excludedRecommendations: [], at: new Date(),
    })).rejects.toMatchObject({ name: 'RepositoryError', repository: 'safetyAuditRepository' });
  });
});
