jest.mock('../../src/infra/mongo', () => ({
  getDb: jest.fn(),
}));

import { getDb } from '../../src/infra/mongo';
import { upsertFeedback } from '../../src/repositories/feedbackRepository';

describe('upsertFeedback', () => {
  const mockUpdateOne = jest.fn();
  const mockCollection = jest.fn(() => ({ updateOne: mockUpdateOne }));

  beforeEach(() => {
    jest.clearAllMocks();
    (getDb as jest.Mock).mockResolvedValue({ collection: mockCollection });
  });

  it('upserts by (sessionId, productName, brand), sets the current rating, and appends to history', async () => {
    const at = new Date('2026-08-15T00:00:00Z');

    await upsertFeedback({
      sessionId: 'sess-1',
      productName: 'CeraVe Moisturizing Cream',
      brand: 'CeraVe',
      rating: 'up',
      at,
    });

    expect(mockCollection).toHaveBeenCalledWith('recommendation_feedback');
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: 'sess-1', productName: 'CeraVe Moisturizing Cream', brand: 'CeraVe' },
      {
        $set: { rating: 'up', updatedAt: at },
        $setOnInsert: {
          sessionId: 'sess-1',
          productName: 'CeraVe Moisturizing Cream',
          brand: 'CeraVe',
          createdAt: at,
        },
        $push: { history: { rating: 'up', at } },
      },
      { upsert: true },
    );
  });

  it('does not set createdAt on $set, so a later call never overwrites the original creation time', async () => {
    await upsertFeedback({
      sessionId: 'sess-1', productName: 'P', brand: 'B', rating: 'down', at: new Date(),
    });

    const update = mockUpdateOne.mock.calls[0][1];
    expect(update.$set).not.toHaveProperty('createdAt');
    expect(update.$setOnInsert).toHaveProperty('createdAt');
  });

  it('throws a RepositoryError when the update fails', async () => {
    mockUpdateOne.mockRejectedValue(new Error('connection lost'));

    await expect(upsertFeedback({
      sessionId: 'sess-1', productName: 'P', brand: 'B', rating: 'up', at: new Date(),
    })).rejects.toMatchObject({ name: 'RepositoryError', repository: 'feedbackRepository' });
  });
});
