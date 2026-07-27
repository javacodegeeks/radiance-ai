import { RepositoryError, AgentError, LlmCallError, SchemaParseError } from '../../src/common/errors';

describe('error hierarchy', () => {
  it('RepositoryError carries repository name, message, and cause', () => {
    const cause = new Error('connection refused');
    const err = new RepositoryError('sessionStore', 'Failed to load session', cause);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RepositoryError');
    expect(err.repository).toBe('sessionStore');
    expect(err.message).toBe('Failed to load session');
    expect(err.cause).toBe(cause);
  });

  it('AgentError carries agent name, message, and cause', () => {
    const err = new AgentError('questioner', 'something went wrong');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AgentError');
    expect(err.agent).toBe('questioner');
    expect(err.cause).toBeUndefined();
  });

  it('LlmCallError is an AgentError with its own name', () => {
    const err = new LlmCallError('recommender', 'timed out');

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('LlmCallError');
    expect(err.agent).toBe('recommender');
  });

  it('SchemaParseError is an AgentError with its own name', () => {
    const err = new SchemaParseError('safetyChecker', 'invalid JSON');

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('SchemaParseError');
    expect(err.agent).toBe('safetyChecker');
  });
});
