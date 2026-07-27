jest.mock('../../src/infra/db', () => ({
  getDb: jest.fn(),
}));
jest.mock('../../src/common/requestContext', () => ({
  getRequestId: jest.fn(),
}));

import { getDb } from '../../src/infra/db';
import { getRequestId } from '../../src/common/requestContext';
import { getSession, setSession, createSession, appendMessage } from '../../src/services/sessionStore';

describe('sessionStore', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    mockQuery.mockReset();
    (getDb as jest.Mock).mockReturnValue({ query: mockQuery });
    (getRequestId as jest.Mock).mockReturnValue(undefined);
  });

  describe('getSession', () => {
    it('returns undefined when no row is found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await getSession('missing-session');

      expect(result).toBeUndefined();
    });

    it('maps a DB row (snake_case) to a Session object (camelCase)', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      mockQuery.mockResolvedValue({
        rows: [{
          session_id: 'sess-1',
          phase: 'collecting',
          profile: null,
          questioning: null,
          created_at: createdAt,
        }],
      });

      const result = await getSession('sess-1');

      expect(result).toEqual({
        id: 'sess-1',
        phase: 'collecting',
        profile: null,
        questioning: null,
        createdAt,
      });
    });

    it('throws a RepositoryError when the query fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(getSession('sess-1')).rejects.toMatchObject({
        name: 'RepositoryError',
        repository: 'sessionStore',
      });
    });
  });

  describe('setSession', () => {
    it('upserts the session with JSON-stringified profile/questioning', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await setSession('sess-1', {
        id: 'sess-1',
        phase: 'done',
        profile: { userQuery: 'dry skin', questionIndex: 0, answers: {} },
        questioning: null,
        createdAt: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['sess-1', 'done', JSON.stringify({ userQuery: 'dry skin', questionIndex: 0, answers: {} }), 'null'],
      );
    });

    it('throws a RepositoryError when the query fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(setSession('sess-1', {
        id: 'sess-1', phase: 'init', profile: null, questioning: null, createdAt: new Date(),
      })).rejects.toMatchObject({ name: 'RepositoryError', repository: 'sessionStore' });
    });
  });

  describe('createSession', () => {
    it('persists and returns a new session with phase "init"', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const session = await createSession('sess-new');

      expect(session.id).toBe('sess-new');
      expect(session.phase).toBe('init');
      expect(session.profile).toBeNull();
      expect(session.questioning).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('appendMessage', () => {
    it('includes the active request ID when persisting a message', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      (getRequestId as jest.Mock).mockReturnValue('req-123');

      await appendMessage('sess-1', 'user', 'hello');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['sess-1', 'user', 'hello', 'req-123'],
      );
    });

    it('persists null for the request ID when none is active', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await appendMessage('sess-1', 'assistant', 'hi there');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['sess-1', 'assistant', 'hi there', null],
      );
    });

    it('throws a RepositoryError when the query fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(appendMessage('sess-1', 'user', 'hello')).rejects.toMatchObject({
        name: 'RepositoryError',
        repository: 'sessionStore',
      });
    });
  });
});
