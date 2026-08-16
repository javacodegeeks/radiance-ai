jest.mock('../../src/repositories/safetyAuditRepository', () => ({
  recordSafetyAudit: jest.fn(),
}));

import { recordSafetyAudit } from '../../src/repositories/safetyAuditRepository';
import { auditSafetyReport } from '../../src/services/safetyAuditService';
import { SafetyReport } from '../../src/types';

describe('auditSafetyReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes each safetyReport bucket through to the repository with the current time', async () => {
    const safetyReport: SafetyReport = {
      hardBlocks: [{ name: 'A', brand: 'B', inci: [], safetyStatus: 'unsafe', relevanceScore: 0 } as never],
      softWarnings: [],
      approved: [],
    };
    const excludedRecommendations = [{ name: 'A', reason: 'unsafe' }];

    await auditSafetyReport({ sessionId: 'sess-1', safetyReport, excludedRecommendations });

    expect(recordSafetyAudit).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      hardBlocks: safetyReport.hardBlocks,
      softWarnings: safetyReport.softWarnings,
      approved: safetyReport.approved,
      excludedRecommendations,
      at: expect.any(Date),
    });
  });
});
