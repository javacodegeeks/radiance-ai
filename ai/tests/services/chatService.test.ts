// uuid@14 ships ESM-only (no CJS build), which ts-jest's CommonJS transform
// can't require() — chatService.ts pulls in v4() purely to stamp message
// ids, so a trivial mock sidesteps the ESM/CJS mismatch entirely.
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('../../src/graph/runner', () => ({
  run: jest.fn(),
}));
jest.mock('../../src/services/sessionStore', () => ({
  getSession: jest.fn(),
  setSession: jest.fn(),
  createSession: jest.fn(),
  appendMessage: jest.fn(),
}));

import { run } from '../../src/graph/runner';
import { getSession, setSession, createSession, appendMessage } from '../../src/services/sessionStore';
import type { Session } from '../../src/services/sessionStore';
import { processMessage } from '../../src/services/chatService';
import { RepositoryError, AgentError } from '../../src/common/errors';
import { PROFILE_QUESTIONS } from '../../src/config/profileQuestions';

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 's1',
    phase: 'init',
    profile: null,
    questioning: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('processMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (setSession as jest.Mock).mockResolvedValue(undefined);
    (appendMessage as jest.Mock).mockResolvedValue(undefined);
  });

  it('creates a new session when none exists yet, then proceeds as init', async () => {
    (getSession as jest.Mock).mockResolvedValue(undefined);
    (createSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'init' }));

    const result = await processMessage('s1', 'hello');

    expect(createSession).toHaveBeenCalledWith('s1');
    expect(result.phase).toBe('collecting');
  });

  it('always records the incoming user message', async () => {
    (getSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'init' }));

    await processMessage('s1', 'hello');

    expect(appendMessage).toHaveBeenCalledWith('s1', 'user', 'hello');
  });

  describe('init phase', () => {
    it('replies with a greeting prompt and does not start collecting yet, for a greeting message', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'init' }));

      const result = await processMessage('s1', 'hello');

      expect(result.phase).toBe('collecting');
      expect(result.messages[0].content).toBe('Hi! What skin or hair concern can I help you with today?');
      expect(setSession).not.toHaveBeenCalled();
    });

    it('starts collecting with the user query as the profile, for a non-greeting message', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'init' }));

      const result = await processMessage('s1', 'I have dry, itchy skin');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({
        phase: 'collecting',
        profile: { userQuery: 'I have dry, itchy skin', questionIndex: 0, answers: {} },
      }));
      expect(result.phase).toBe('collecting');
      expect(result.messages[0].content).toContain(PROFILE_QUESTIONS[0].text);
    });
  });

  describe('collecting phase', () => {
    it('advances to the next question when more remain', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: { userQuery: 'dry skin', questionIndex: 0, answers: {} },
      }));

      const result = await processMessage('s1', 'UK');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({
        profile: { userQuery: 'dry skin', questionIndex: 1, answers: { country: 'UK' } },
      }));
      expect(result.phase).toBe('collecting');
      expect(result.messages[0].content).toBe(PROFILE_QUESTIONS[1].text);
    });

    it('invokes the graph after the last question, returning recommendations on success', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: {
          userQuery: 'dry skin',
          questionIndex: PROFILE_QUESTIONS.length - 1,
          answers: { country: 'UK', skinType: 'dry', allergies: 'none' },
        },
      }));
      (run as jest.Mock).mockResolvedValue({
        finalRecommendations: [{ name: 'Gentle Cleanser' }],
        pendingQuestions: [],
      });

      const result = await processMessage('s1', 'none');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({ phase: 'processing' }));
      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({ phase: 'done' }));
      expect(result.phase).toBe('done');
      expect(result.recommendations).toEqual([{ name: 'Gentle Cleanser' }]);
      expect(appendMessage).toHaveBeenCalledWith('s1', 'assistant', result.messages[0].content);
    });

    it('returns a "no products found" response when the graph yields no recommendations', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: {
          userQuery: 'dry skin',
          questionIndex: PROFILE_QUESTIONS.length - 1,
          answers: { country: 'UK', skinType: 'dry', allergies: 'none' },
        },
      }));
      (run as jest.Mock).mockResolvedValue({ finalRecommendations: [], pendingQuestions: [] });

      const result = await processMessage('s1', 'none');

      expect(result.phase).toBe('done');
      expect(result.recommendations).toEqual([]);
      expect(result.messages[0].content).toContain("couldn't find suitable products");
    });

    it('moves to questioning when the graph asks a follow-up question', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: {
          userQuery: 'dry skin',
          questionIndex: PROFILE_QUESTIONS.length - 1,
          answers: { country: 'UK', skinType: 'dry', allergies: 'none' },
        },
      }));
      (run as jest.Mock).mockResolvedValue({
        finalRecommendations: [],
        pendingQuestions: ['Are you currently using any retinoids?'],
      });

      const result = await processMessage('s1', 'none');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({
        phase: 'questioning',
        questioning: expect.objectContaining({
          pendingQuestions: ['Are you currently using any retinoids?'],
          questionIndex: 0,
        }),
      }));
      expect(result.phase).toBe('questioning');
      expect(result.messages[0].content).toBe('Are you currently using any retinoids?');
    });

    it('sets phase to error and returns a data-service message when the graph throws a RepositoryError', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: {
          userQuery: 'dry skin',
          questionIndex: PROFILE_QUESTIONS.length - 1,
          answers: { country: 'UK', skinType: 'dry', allergies: 'none' },
        },
      }));
      (run as jest.Mock).mockRejectedValue(new RepositoryError('productRepository', 'db down'));

      const result = await processMessage('s1', 'none');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({ phase: 'error' }));
      expect(result.phase).toBe('error');
      expect(result.messages[0].content).toContain('data service is temporarily unavailable');
    });

    it('sets phase to error and returns an engine message when the graph throws an AgentError', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'collecting',
        profile: {
          userQuery: 'dry skin',
          questionIndex: PROFILE_QUESTIONS.length - 1,
          answers: { country: 'UK', skinType: 'dry', allergies: 'none' },
        },
      }));
      (run as jest.Mock).mockRejectedValue(new AgentError('recommender', 'llm timeout'));

      const result = await processMessage('s1', 'none');

      expect(result.phase).toBe('error');
      expect(result.messages[0].content).toContain('recommendation engine encountered an error');
    });
  });

  describe('questioning phase', () => {
    it('advances to the next pending question when more remain', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'questioning',
        questioning: {
          userQuery: 'dry skin',
          existingProfile: {},
          pendingQuestions: ['Q1?', 'Q2?'],
          questionIndex: 0,
          conversationHistory: [],
        },
      }));

      const result = await processMessage('s1', 'answer to Q1');

      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({
        questioning: expect.objectContaining({ questionIndex: 1 }),
      }));
      expect(result.phase).toBe('questioning');
      expect(result.messages[0].content).toBe('Q2?');
    });

    it('invokes the graph with the accumulated conversation history after the last pending question', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({
        phase: 'questioning',
        questioning: {
          userQuery: 'dry skin',
          existingProfile: { country: 'UK' },
          pendingQuestions: ['Q1?'],
          questionIndex: 0,
          conversationHistory: [],
        },
      }));
      (run as jest.Mock).mockResolvedValue({
        finalRecommendations: [{ name: 'Gentle Cleanser' }],
        pendingQuestions: [],
      });

      const result = await processMessage('s1', 'answer to Q1');

      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 's1',
        userQuery: 'dry skin',
        existingProfile: { country: 'UK' },
        conversationHistory: [
          expect.objectContaining({ role: 'assistant', content: 'Q1?' }),
          expect.objectContaining({ role: 'user', content: 'answer to Q1' }),
        ],
      }));
      expect(result.phase).toBe('done');
    });
  });

  describe('done / error phase', () => {
    it.each(['done', 'error'] as const)('implicitly restarts a new session from phase=%s', async (phase) => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({ phase }));
      (createSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'init' }));

      const result = await processMessage('s1', 'new concern');

      expect(createSession).toHaveBeenCalledWith('s1');
      expect(setSession).toHaveBeenCalledWith('s1', expect.objectContaining({
        phase: 'collecting',
        profile: { userQuery: 'new concern', questionIndex: 0, answers: {} },
      }));
      expect(result.phase).toBe('collecting');
      expect(result.messages[0].content).toContain('Starting a new search.');
    });
  });

  describe('unrecognized session shape', () => {
    it('falls back to a generic prompt when the phase/state combination matches nothing', async () => {
      (getSession as jest.Mock).mockResolvedValue(makeSession({ phase: 'collecting', profile: null }));

      const result = await processMessage('s1', 'anything');

      expect(result.phase).toBe('collecting');
      expect(result.messages[0].content).toContain('Tell me about your skin or hair concern');
    });
  });
});
