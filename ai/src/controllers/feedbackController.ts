/**
 * Feedback controller — HTTP layer only.
 * Extracts request data, delegates to feedbackService, returns JSON.
 * No business logic lives here.
 */

import { Router, Request, Response } from 'express';
import { recordFeedback } from '../services/feedbackService';
import { RepositoryError } from '../common/errors';

export const feedbackRouter = Router();

feedbackRouter.post('/feedback', async (req: Request, res: Response) => {
  const { sessionId, productName, brand, rating } = req.body as {
    sessionId?: string;
    productName?: string;
    brand?: string;
    rating?: string;
  };

  if (!sessionId || !productName || !brand || (rating !== 'up' && rating !== 'down')) {
    res.status(400).json({ error: 'sessionId, productName, brand and rating ("up" | "down") are required' });
    return;
  }

  try {
    await recordFeedback({ sessionId, productName, brand, rating });
    res.status(204).end();
  } catch (error) {
    console.error('[feedback] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to record feedback. Please try again.' });
  }
});
