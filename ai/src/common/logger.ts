/**
 * Installs a one-time console patch that prefixes every log line with the
 * active request's correlation ID (see requestContext.ts), when one is set.
 *
 * Call installRequestIdLogging() once at process startup (server.ts).
 * No call sites elsewhere in the codebase need to change — every existing
 * console.log/warn/error/debug call across agents, repositories, and the
 * LLM client automatically picks up the prefix for the request it runs
 * inside, letting a single chat turn's logs be grepped by `[req=<id>]`.
 */
import { getRequestId } from './requestContext';

type ConsoleMethod = 'log' | 'warn' | 'error' | 'debug';

let installed = false;

export function installRequestIdLogging(): void {
  if (installed) return;
  installed = true;

  (['log', 'warn', 'error', 'debug'] as ConsoleMethod[]).forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const requestId = getRequestId();
      if (requestId) {
        original(`[req=${requestId}]`, ...args);
      } else {
        original(...args);
      }
    };
  });
}
