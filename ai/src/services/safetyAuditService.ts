/**
 * Safety audit service — persists the safety checker's verdicts for a
 * session, independent of the HTTP response that also carries them.
 */

import { recordSafetyAudit } from '../repositories/safetyAuditRepository';
import { ExcludedRecommendation, SafetyReport } from '../types';

export interface AuditSafetyReportInput {
  sessionId: string;
  safetyReport: SafetyReport;
  excludedRecommendations: ExcludedRecommendation[];
}

export async function auditSafetyReport(input: AuditSafetyReportInput): Promise<void> {
  await recordSafetyAudit({
    sessionId:               input.sessionId,
    hardBlocks:              input.safetyReport.hardBlocks,
    softWarnings:            input.safetyReport.softWarnings,
    approved:                input.safetyReport.approved,
    excludedRecommendations: input.excludedRecommendations,
    at:                      new Date(),
  });
}
