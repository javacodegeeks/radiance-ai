/**
 * Minimal error hierarchy for admin/server/ — same shape as
 * ai/src/common/errors.ts's RepositoryError (package independence means
 * this is a small duplicate, not a shared import).
 */
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
