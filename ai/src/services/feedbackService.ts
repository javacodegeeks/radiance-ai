/**
 * Feedback service — records user thumbs up/down signal on a recommended
 * product. No HTTP knowledge: takes plain values, returns void.
 */

import { upsertFeedback, FeedbackRating } from '../repositories/feedbackRepository';

export interface RecordFeedbackInput {
  sessionId: string;
  productName: string;
  brand: string;
  rating: FeedbackRating;
}

export async function recordFeedback(input: RecordFeedbackInput): Promise<void> {
  await upsertFeedback({
    sessionId:   input.sessionId,
    productName: input.productName,
    brand:       input.brand,
    rating:      input.rating,
    at:          new Date(),
  });
}
