jest.mock('../../src/graph/workflow', () => ({
  graph: { stream: jest.fn() },
}));
jest.mock('../../src/services/safetyAuditService', () => ({
  auditSafetyReport: jest.fn(),
}));

import { graph } from '../../src/graph/workflow';
import { auditSafetyReport } from '../../src/services/safetyAuditService';
import { run } from '../../src/graph/runner';
import { GraphStateType } from '../../src/graph/state';

/** Wraps a fixed list of state chunks as the async iterable graph.stream() resolves to. */
function fakeStream(chunks: Array<Partial<GraphStateType>>): AsyncIterable<Partial<GraphStateType>> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
      };
    },
  };
}

const emptySafetyReport = { approved: [], softWarnings: [], hardBlocks: [] };

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the last streamed chunk as the final state', async () => {
    (graph.stream as jest.Mock).mockResolvedValue(fakeStream([
      { currentStep: 'interview' },
      { currentStep: 'recommend', finalRecommendations: [{ name: 'Product A' } as never] },
    ]));

    const result = await run({ sessionId: 'sess-1', userQuery: 'dry skin' });

    expect(result.currentStep).toBe('recommend');
    expect(result.finalRecommendations).toEqual([{ name: 'Product A' }]);
  });

  it('calls onProgress once per distinct labeled step, skipping repeats and unlabeled steps', async () => {
    (graph.stream as jest.Mock).mockResolvedValue(fakeStream([
      { currentStep: 'interview' },
      { currentStep: 'interview' }, // same step again — should not re-fire
      { currentStep: 'safety_check' },
      { currentStep: 'done' as never }, // no STEP_LABELS entry — should not fire
    ]));
    const onProgress = jest.fn();

    await run({ sessionId: 'sess-1', userQuery: 'dry skin', onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'Reviewing your profile...');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'Checking ingredient safety...');
  });

  it('persists the safety audit with the final safetyReport and excludedRecommendations', async () => {
    const safetyReport = { ...emptySafetyReport, hardBlocks: [{ name: 'Unsafe Product' } as never] };
    const excludedRecommendations = [{ name: 'Unsafe Product', reason: 'unsafe' }];
    (graph.stream as jest.Mock).mockResolvedValue(fakeStream([
      { currentStep: 'recommend', safetyReport, excludedRecommendations },
    ]));

    await run({ sessionId: 'sess-42', userQuery: 'oily skin' });

    expect(auditSafetyReport).toHaveBeenCalledWith({
      sessionId: 'sess-42',
      safetyReport,
      excludedRecommendations,
    });
  });

  it('still returns finalState when auditSafetyReport fails — a failed audit write must not break the chat response', async () => {
    (graph.stream as jest.Mock).mockResolvedValue(fakeStream([
      { currentStep: 'recommend', finalRecommendations: [{ name: 'Product A' } as never] },
    ]));
    (auditSafetyReport as jest.Mock).mockRejectedValue(new Error('mongo down'));

    const result = await run({ sessionId: 'sess-1', userQuery: 'dry skin' });

    expect(result.finalRecommendations).toEqual([{ name: 'Product A' }]);
  });
});
