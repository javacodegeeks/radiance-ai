import { runWithRequestId, getRequestId } from '../../src/common/requestContext';

describe('requestContext', () => {
  it('returns undefined when called outside of runWithRequestId', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('makes the request ID available to code running inside the callback', () => {
    const result = runWithRequestId('req-123', () => getRequestId());
    expect(result).toBe('req-123');
  });

  it('makes the request ID available to nested async calls within the same context', async () => {
    const observed = await runWithRequestId('req-456', async () => {
      await Promise.resolve();
      return getRequestId();
    });
    expect(observed).toBe('req-456');
  });

  it('isolates request IDs between separate calls (no leakage)', () => {
    runWithRequestId('req-a', () => {
      expect(getRequestId()).toBe('req-a');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('returns the callback return value unchanged', () => {
    const result = runWithRequestId('req-789', () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });
});
