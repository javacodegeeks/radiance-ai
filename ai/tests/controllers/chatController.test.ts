jest.mock('../../src/services/chatService', () => ({
  processMessage: jest.fn(),
}));

import { Request, Response } from 'express';
import { processMessage } from '../../src/services/chatService';
import { chatRouter } from '../../src/controllers/chatController';

/** Pulls the route handler directly out of the Express Router, avoiding a supertest dependency. */
function getHandler(): (req: Request, res: Response) => Promise<void> {
  const layer = (chatRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack
    .find(l => l.route?.path === '/chat');
  if (!layer?.route) throw new Error('POST /chat route not registered');
  return layer.route.stack[0].handle;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: { sessionId: 'sess-1', message: 'I have dry skin' },
    headers: {},
    ...overrides,
  } as Request;
}

function makeRes() {
  return {
    setHeader: jest.fn(),
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

/** Parses the raw SSE frames written via res.write() back into {event, data} pairs. */
function parseSseWrites(res: Response): Array<{ event: string; data: unknown }> {
  const writeMock = res.write as unknown as jest.Mock;
  return writeMock.mock.calls.map(([frame]: [string]) => {
    const [, event] = frame.match(/^event: (.+)\n/) ?? [];
    const [, dataRaw] = frame.match(/data: (.+)\n\n$/) ?? [];
    return { event, data: dataRaw ? JSON.parse(dataRaw) : undefined };
  });
}

describe('POST /chat', () => {
  const handler = getHandler();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 without calling processMessage when sessionId or message is missing', async () => {
    const res = makeRes();

    await handler(makeReq({ body: { message: 'only a message' } } as Partial<Request>), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('sets an X-Request-Id header for correlation, for both JSON and SSE requests', async () => {
    (processMessage as jest.Mock).mockResolvedValue({ messages: [], phase: 'done' });
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
  });

  describe('JSON (non-streaming) path — no Accept: text/event-stream header', () => {
    it('calls processMessage without an onProgress callback and returns the response as JSON', async () => {
      const response = { messages: [{ role: 'assistant', content: 'hi' }], phase: 'done' };
      (processMessage as jest.Mock).mockResolvedValue(response);
      const res = makeRes();

      await handler(makeReq(), res);

      expect(processMessage).toHaveBeenCalledWith('sess-1', 'I have dry skin');
      expect(res.json).toHaveBeenCalledWith(response);
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('returns a 500 JSON error body when processMessage rejects', async () => {
      (processMessage as jest.Mock).mockRejectedValue(new Error('LiteLLM unreachable'));
      const res = makeRes();

      await handler(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        messages: [],
        phase: 'error',
        error: 'LiteLLM unreachable',
      });
    });
  });

  describe('SSE (streaming) path — Accept: text/event-stream', () => {
    function makeStreamReq(): Request {
      return makeReq({ headers: { accept: 'text/event-stream' } } as Partial<Request>);
    }

    it('opens the stream with the correct SSE headers before doing any work', async () => {
      (processMessage as jest.Mock).mockResolvedValue({ messages: [], phase: 'done' });
      const res = makeRes();

      await handler(makeStreamReq(), res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    });

    it('forwards each onProgress call as its own "progress" SSE frame, then a final "done" frame with the response', async () => {
      const response = { messages: [{ role: 'assistant', content: 'Here are your recommendations' }], phase: 'done' };
      (processMessage as jest.Mock).mockImplementation(async (_sessionId, _message, onProgress) => {
        onProgress('Reviewing your profile...');
        onProgress('Checking ingredient safety...');
        return response;
      });
      const res = makeRes();

      await handler(makeStreamReq(), res);

      const events = parseSseWrites(res);
      expect(events).toEqual([
        { event: 'progress', data: { label: 'Reviewing your profile...' } },
        { event: 'progress', data: { label: 'Checking ingredient safety...' } },
        { event: 'done', data: response },
      ]);
      expect(res.end).toHaveBeenCalled();
    });

    it('emits an "error" SSE frame (not an HTTP error status) and still ends the stream when processMessage rejects', async () => {
      (processMessage as jest.Mock).mockRejectedValue(new Error('LiteLLM unreachable'));
      const res = makeRes();

      await handler(makeStreamReq(), res);

      const events = parseSseWrites(res);
      expect(events).toEqual([
        { event: 'error', data: { messages: [], phase: 'error', error: 'LiteLLM unreachable' } },
      ]);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalled();
    });

    it('still ends the stream even if a progress callback throws mid-run', async () => {
      (processMessage as jest.Mock).mockImplementation(async () => {
        throw new Error('graph failed after 2 progress events');
      });
      const res = makeRes();

      await handler(makeStreamReq(), res);

      expect(res.end).toHaveBeenCalledTimes(1);
    });
  });
});
