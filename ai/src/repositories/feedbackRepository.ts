import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'recommendation_feedback';

export type FeedbackRating = 'up' | 'down';

export interface FeedbackRecord {
  sessionId: string;
  productName: string;
  brand: string;
  rating: FeedbackRating;
  updatedAt: Date;
}

/**
 * Upserts a rating for (sessionId, productName, brand) — a user can change
 * their mind (up -> down) but each recommendation only ever holds one rating
 * per session, not a growing history of clicks.
 */
export async function upsertFeedback(record: FeedbackRecord): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<FeedbackRecord>(COLLECTION_NAME).updateOne(
      { sessionId: record.sessionId, productName: record.productName, brand: record.brand },
      { $set: record },
      { upsert: true },
    );
  } catch (err) {
    throw new RepositoryError('feedbackRepository', 'Failed to record recommendation feedback', err);
  }
}
