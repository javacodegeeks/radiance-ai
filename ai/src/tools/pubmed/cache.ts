// ─── TTL-based in-memory cache ────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class InMemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  /**
   * Build a deterministic cache key from any number of values.
   * Strings are used as-is; everything else is JSON-serialised.
   */
  buildKey(...parts: unknown[]): string {
    return parts
      .map(p => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(':');
  }
}

/** Singleton shared across all PubMed tool invocations within the process */
export const pubmedCache = new InMemoryCache();
