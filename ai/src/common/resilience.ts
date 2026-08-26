/**
 * Small resilience helpers for calls to external/slow services (e.g. Tavily).
 * Kept intentionally minimal — in-memory, per-process state, no external deps.
 */

/** Rejects if `promise` doesn't settle within `ms`. Does not cancel the underlying call. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a trial call again. */
  cooldownMs: number;
}

/**
 * Basic consecutive-failure circuit breaker. While open, `isOpen()` returns true
 * so callers can skip the external call entirely (fail fast) instead of piling up
 * timeouts against a service that's already down.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  isOpen(): boolean {
    if (this.openedAt === null) return false;

    if (Date.now() - this.openedAt >= this.options.cooldownMs) {
      // Cooldown elapsed — half-open: let the next call through as a trial.
      this.openedAt = null;
      this.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold && this.openedAt === null) {
      this.openedAt = Date.now();
      console.warn(`[circuitBreaker:${this.name}] opened after ${this.consecutiveFailures} consecutive failures`);
    }
  }
}
