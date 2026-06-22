/**
 * Normalized error hierarchy for the AI layer.
 *
 * Throwing rules:
 *   - Repositories   → throw RepositoryError (wraps native DB/driver errors)
 *   - LLM API calls  → throw LlmCallError    (wraps OpenAI SDK errors)
 *   - JSON/Zod parse → throw SchemaParseError (wraps SyntaxError / ZodError)
 *   - Agent internals never re-throw — they catch typed errors, log, and fall back.
 *   - chatService wraps run() and catches anything that escapes.
 */

// ─── Repository layer ─────────────────────────────────────────────────────────

export class RepositoryError extends Error {
  constructor(
    public readonly repository: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

// ─── Agent layer ──────────────────────────────────────────────────────────────

export class AgentError extends Error {
  constructor(
    public readonly agent: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/** LLM API call failed (network, timeout, rate-limit, etc.) */
export class LlmCallError extends AgentError {
  constructor(agent: string, message: string, cause?: unknown) {
    super(agent, message, cause);
    this.name = 'LlmCallError';
  }
}

/** LLM returned a response that failed JSON.parse or Zod schema validation. */
export class SchemaParseError extends AgentError {
  constructor(agent: string, message: string, cause?: unknown) {
    super(agent, message, cause);
    this.name = 'SchemaParseError';
  }
}
