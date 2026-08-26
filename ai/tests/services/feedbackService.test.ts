jest.mock('../../src/repositories/feedbackRepository', () => ({
  upsertFeedback: jest.fn(),
}));

import { upsertFeedback } from '../../src/repositories/feedbackRepository';
import { recordFeedback } from '../../src/services/feedbackService';

describe('recordFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the input through to the repository with a freshly generated timestamp', async () => {
    (upsertFeedback as jest.Mock).mockResolvedValue(undefined);
    const before = Date.now();

    await recordFeedback({ sessionId: 'sess-1', productName: 'Product A', brand: 'Brand A', rating: 'up' });

    const after = Date.now();
    expect(upsertFeedback).toHaveBeenCalledTimes(1);
    const call = (upsertFeedback as jest.Mock).mock.calls[0][0];
    expect(call).toMatchObject({
      sessionId: 'sess-1',
      productName: 'Product A',
      brand: 'Brand A',
      rating: 'up',
    });
    expect(call.at).toBeInstanceOf(Date);
    expect(call.at.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.at.getTime()).toBeLessThanOrEqual(after);
  });

  it('propagates a repository failure rather than swallowing it', async () => {
    (upsertFeedback as jest.Mock).mockRejectedValue(new Error('mongo down'));

    await expect(recordFeedback({
      sessionId: 'sess-1', productName: 'Product A', brand: 'Brand A', rating: 'down',
    })).rejects.toThrow('mongo down');
  });
});
