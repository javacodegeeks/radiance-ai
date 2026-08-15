import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';
import { ExcludedRecommendation, RecommendedProduct } from '../types';

const COLLECTION_NAME = 'safety_audit_log';

/** Lean projection of a RecommendedProduct — only what's needed to answer
 * "why was product X excluded/flagged in this session," not the recommender's
 * user-facing fields (reasoning/usageTips/confidence), which belong to a
 * different concern. */
export interface SafetyAuditEntry {
  name: string;
  brand: string;
  safetyStatus: RecommendedProduct['safetyStatus'];
  safetyNotes?: string;
}

export interface SafetyAuditRecord {
  sessionId: string;
  hardBlocks: SafetyAuditEntry[];
  softWarnings: SafetyAuditEntry[];
  approved: SafetyAuditEntry[];
  /** Products the Recommender's LLM call itself chose to exclude — a
   * separate decision from the Layer 1/2 safety verdicts above. */
  excludedRecommendations: ExcludedRecommendation[];
  createdAt: Date;
}

export interface RecordSafetyAuditInput {
  sessionId: string;
  hardBlocks: RecommendedProduct[];
  softWarnings: RecommendedProduct[];
  approved: RecommendedProduct[];
  excludedRecommendations: ExcludedRecommendation[];
  at: Date;
}

function toEntry(p: RecommendedProduct): SafetyAuditEntry {
  return {
    name: p.name,
    brand: p.brand,
    safetyStatus: p.safetyStatus,
    ...(p.safetyNotes && { safetyNotes: p.safetyNotes }),
  };
}

/**
 * Insert-only audit record of one graph run's safety verdicts. The same data
 * is also returned in the chat HTTP response, but that copy is gone once the
 * response is sent — this is the durable copy, so "why was product X
 * excluded from session Y" stays answerable after the fact.
 */
export async function recordSafetyAudit(input: RecordSafetyAuditInput): Promise<void> {
  try {
    const db = await getDb();
    const record: SafetyAuditRecord = {
      sessionId:                input.sessionId,
      hardBlocks:               input.hardBlocks.map(toEntry),
      softWarnings:             input.softWarnings.map(toEntry),
      approved:                 input.approved.map(toEntry),
      excludedRecommendations:  input.excludedRecommendations,
      createdAt:                input.at,
    };
    await db.collection<SafetyAuditRecord>(COLLECTION_NAME).insertOne(record);
  } catch (err) {
    throw new RepositoryError('safetyAuditRepository', 'Failed to record safety audit', err);
  }
}
