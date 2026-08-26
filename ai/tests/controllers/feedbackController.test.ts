jest.mock('../../src/services/feedbackService', () => ({
  recordFeedback: jest.fn(),
}));

import { Request, Response } from 'express';
import { recordFeedback } from '../../src/services/feedbackService';
import { feedbackRouter } from '../../src/controllers/feedbackController';
import { RepositoryError } from '../../src/common/errors';

/** Pulls the route handler directly out of the Express Router, avoiding a supertest dependency. */
function getHandler(): (req: Request, res: Response) => Promise<void> {
  const layer = (feedbackRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } }> }).stack
    .find(l => l.route?.path === '/feedback');
  if (!layer?.route) throw new Error('POST /feedback route not registered');
  return layer.route.stack[0].handle;
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('POST /feedback', () => {
  const handler = getHandler();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when a required field is missing', async () => {
    const req = { body: { productName: 'P', brand: 'B', rating: 'up' } } as Request;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('returns 400 when rating is neither "up" nor "down"', async () => {
    const req = { body: { sessionId: 's', productName: 'P', brand: 'B', rating: 'meh' } } as Request;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('delegates to recordFeedback and returns 204 on success', async () => {
    (recordFeedback as jest.Mock).mockResolvedValue(undefined);
    const req = { body: { sessionId: 's', productName: 'P', brand: 'B', rating: 'up' } } as Request;
    const res = makeRes();

    await handler(req, res);

    expect(recordFeedback).toHaveBeenCalledWith({ sessionId: 's', productName: 'P', brand: 'B', rating: 'up' });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 503 when recordFeedback throws a RepositoryError', async () => {
    (recordFeedback as jest.Mock).mockRejectedValue(new RepositoryError('feedbackRepository', 'db down'));
    const req = { body: { sessionId: 's', productName: 'P', brand: 'B', rating: 'up' } } as Request;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 500 on an unexpected non-RepositoryError failure', async () => {
    (recordFeedback as jest.Mock).mockRejectedValue(new Error('boom'));
    const req = { body: { sessionId: 's', productName: 'P', brand: 'B', rating: 'down' } } as Request;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
