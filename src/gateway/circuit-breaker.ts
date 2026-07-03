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

  recordFailure(backend: Backend) {
    const now = Date.now();
    const s = this.state(backend);
    s.failures = s.failures.filter(
      (t) => now - t < constants.circuitBreakerWindowMs
    );
    s.failures.push(now);
    if (s.failures.length >= constants.circuitBreakerFailureThreshold) {
      s.openUntil = now + constants.circuitBreakerOpenMs;
    }
  }

  retryAfterMs(backend: Backend): number {
    const s = this.state(backend);
    return Math.max(0, s.openUntil - Date.now());
  }
}

export const circuitBreaker = new CircuitBreaker();
