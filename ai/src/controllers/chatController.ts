/**
 * Chat controller — HTTP layer only.
 * Extracts request data, delegates to chatService, returns JSON.
 * No business logic lives here.
 */

import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { processMessage } from '../services/chatService';
import { runWithRequestId } from '../common/requestContext';

export const chatRouter = Router();

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as { sessionId: string; message: string };

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required' });
    return;
  }

  // Short, grep-friendly ID correlating every log line this chat turn
  // produces — across chatService, the LangGraph agents, and repositories —
  // even though those layers have no direct reference to the HTTP request.
  const requestId = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', requestId);

  await runWithRequestId(requestId, async () => {
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
});
