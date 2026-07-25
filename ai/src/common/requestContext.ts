/**
 * Per-request correlation ID, propagated via AsyncLocalStorage.
 *
 * Set once at the HTTP boundary (chatController) and read implicitly by
 * every console.log/warn/error call for the lifetime of that request —
 * including calls deep inside agents/repositories that have no direct
 * reference to the request. See common/logger.ts for how it's applied.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run(requestId, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore();
}
