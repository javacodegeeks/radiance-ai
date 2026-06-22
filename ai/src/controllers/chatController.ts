/**
 * Chat controller — HTTP layer only.
 * Extracts request data, delegates to chatService, returns JSON.
 * No business logic lives here.
 */

import { Router, Request, Response } from 'express';
import { processMessage } from '../services/chatService';

export const chatRouter = Router();

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as { sessionId: string; message: string };

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required' });
    return;
  }

  const start = Date.now();
  console.log(`[chat] POST session=${sessionId}`);

  try {
    const response = await processMessage(sessionId, message);
    console.log(`[chat] → phase=${response.phase} ${Date.now() - start}ms`);
    res.json(response);
  } catch (error) {
    console.error(`[chat] → ERROR ${Date.now() - start}ms`, error);
    res.status(500).json({
      messages: [],
      phase: 'error',
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});
