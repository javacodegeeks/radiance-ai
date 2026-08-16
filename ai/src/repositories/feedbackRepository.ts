import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'recommendation_feedback';

export type FeedbackRating = 'up' | 'down';

export interface FeedbackEvent {
  rating: FeedbackRating;
  at: Date;
}

export interface FeedbackRecord {
  sessionId: string;
  productName: string;
  brand: string;
  rating: FeedbackRating;
  createdAt: Date;
  updatedAt: Date;
  history: FeedbackEvent[];
}

export interface UpsertFeedbackInput {
  sessionId: string;
  productName: string;
  brand: string;
  rating: FeedbackRating;
  at: Date;
}

/**
 * Records a rating for (sessionId, productName, brand). `rating`/`updatedAt`
 * reflect the current state (so "what does this session currently think of
 * this product" stays a cheap lookup), but every change is also appended to
 * `history` so a reversal (up -> down) isn't silently lost.
 */
export async function upsertFeedback(input: UpsertFeedbackInput): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<FeedbackRecord>(COLLECTION_NAME).updateOne(
      { sessionId: input.sessionId, productName: input.productName, brand: input.brand },
      {
        $set: { rating: input.rating, updatedAt: input.at },
        $setOnInsert: {
          sessionId: input.sessionId,
          productName: input.productName,
          brand: input.brand,
          createdAt: input.at,
        },
        $push: { history: { rating: input.rating, at: input.at } },
      },
      { upsert: true },
    );
  } catch (err) {
    throw new RepositoryError('feedbackRepository', 'Failed to record recommendation feedback', err);
  }
}
