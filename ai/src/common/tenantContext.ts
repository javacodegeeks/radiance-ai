/**
 * Per-request resolved tenantId, propagated via AsyncLocalStorage — same
 * shape as common/requestContext.ts's requestId.
 *
 * Set once at the HTTP boundary (middleware/tenantResolution.ts) and read
 * implicitly by anything deep inside agents/repositories that needs to
 * scope a query to "shared base + this tenant's own additions" without
 * threading tenantId through every function signature in between (e.g.
 * agents/productFinder.ts -> repositories/productRepository.ts).
 * undefined means no tenant was resolved (unrecognized/missing subdomain)
 * — callers must fail open to the shared base catalog only, never error.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string | undefined>();

export function runWithTenantId<T>(tenantId: string | undefined, fn: () => T): T {
  return storage.run(tenantId, fn);
}

export function getTenantId(): string | undefined {
  return storage.getStore();
}
