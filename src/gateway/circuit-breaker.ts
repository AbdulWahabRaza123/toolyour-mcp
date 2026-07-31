import { constants } from "../config";

type Backend = "node" | "python";

interface BreakerState {
  failures: number[];
  openUntil: number;
}

export class CircuitBreaker {
  private states = new Map<Backend, BreakerState>();

  private state(backend: Backend): BreakerState {
    let s = this.states.get(backend);
    if (!s) {
      s = { failures: [], openUntil: 0 };
      this.states.set(backend, s);
    }
    return s;
  }

  isOpen(backend: Backend): boolean {
    const s = this.state(backend);
    if (Date.now() < s.openUntil) return true;
    if (s.openUntil > 0 && Date.now() >= s.openUntil) {
      s.openUntil = 0;
      s.failures = [];
    }
    return false;
  }

  recordSuccess(backend: Backend) {
    const s = this.state(backend);
    s.failures = [];
    s.openUntil = 0;
  }

  /** Returns true when this failure newly opens the breaker. */
  recordFailure(backend: Backend): boolean {
    const now = Date.now();
    const s = this.state(backend);
    const wasOpen = now < s.openUntil;
    s.failures = s.failures.filter(
      (t) => now - t < constants.circuitBreakerWindowMs
    );
    s.failures.push(now);
    if (s.failures.length >= constants.circuitBreakerFailureThreshold) {
      s.openUntil = now + constants.circuitBreakerOpenMs;
      return !wasOpen;
    }
    return false;
  }

  retryAfterMs(backend: Backend): number {
    const s = this.state(backend);
    return Math.max(0, s.openUntil - Date.now());
  }

  /** Snapshot for health endpoints. */
  snapshot(): Record<string, { open: boolean; retryAfterMs: number; recentFailures: number }> {
    const backends: Array<"node" | "python"> = ["node", "python"];
    const out: Record<
      string,
      { open: boolean; retryAfterMs: number; recentFailures: number }
    > = {};
    for (const b of backends) {
      const s = this.state(b);
      const now = Date.now();
      out[b] = {
        open: now < s.openUntil,
        retryAfterMs: Math.max(0, s.openUntil - now),
        recentFailures: s.failures.filter(
          (t) => now - t < constants.circuitBreakerWindowMs
        ).length,
      };
    }
    return out;
  }
}

export const circuitBreaker = new CircuitBreaker();
