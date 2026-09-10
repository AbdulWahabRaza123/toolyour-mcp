import { constants } from "../config";

type Backend = "node" | "python";

interface BreakerState {
  failures: number[];
  openUntil: number;
  /** After open window expires, only one probe is admitted until success/failure. */
  halfOpen: boolean;
  probing: boolean;
}

export class CircuitBreaker {
  private states = new Map<Backend, BreakerState>();
  private readonly openMs: number;
  private readonly windowMs: number;
  private readonly failureThreshold: number;

  constructor(opts?: {
    openMs?: number;
    windowMs?: number;
    failureThreshold?: number;
  }) {
    this.openMs = opts?.openMs ?? constants.circuitBreakerOpenMs;
    this.windowMs = opts?.windowMs ?? constants.circuitBreakerWindowMs;
    this.failureThreshold =
      opts?.failureThreshold ?? constants.circuitBreakerFailureThreshold;
  }

  private state(backend: Backend): BreakerState {
    let s = this.states.get(backend);
    if (!s) {
      s = { failures: [], openUntil: 0, halfOpen: false, probing: false };
      this.states.set(backend, s);
    }
    return s;
  }

  isOpen(backend: Backend): boolean {
    const s = this.state(backend);
    const now = Date.now();
    if (now < s.openUntil) return true;

    if (s.openUntil > 0 && now >= s.openUntil) {
      // Transition to half-open instead of clearing the herd into full traffic.
      s.openUntil = 0;
      s.halfOpen = true;
      s.probing = false;
      s.failures = [];
    }

    if (s.halfOpen) {
      if (s.probing) return true;
      s.probing = true;
      return false;
    }

    return false;
  }

  recordSuccess(backend: Backend) {
    const s = this.state(backend);
    s.failures = [];
    s.openUntil = 0;
    s.halfOpen = false;
    s.probing = false;
  }

  /** Returns true when this failure newly opens the breaker. */
  recordFailure(backend: Backend): boolean {
    const now = Date.now();
    const s = this.state(backend);
    const wasOpen = now < s.openUntil;

    if (s.halfOpen) {
      s.halfOpen = false;
      s.probing = false;
      s.openUntil = now + this.openMs;
      s.failures = [now];
      return !wasOpen;
    }

    s.probing = false;
    s.failures = s.failures.filter((t) => now - t < this.windowMs);
    s.failures.push(now);
    if (s.failures.length >= this.failureThreshold) {
      s.openUntil = now + this.openMs;
      return !wasOpen;
    }
    return false;
  }

  retryAfterMs(backend: Backend): number {
    const s = this.state(backend);
    return Math.max(0, s.openUntil - Date.now());
  }

  /** Snapshot for health endpoints. */
  snapshot(): Record<
    string,
    {
      open: boolean;
      halfOpen: boolean;
      retryAfterMs: number;
      recentFailures: number;
    }
  > {
    const backends: Array<"node" | "python"> = ["node", "python"];
    const out: Record<
      string,
      {
        open: boolean;
        halfOpen: boolean;
        retryAfterMs: number;
        recentFailures: number;
      }
    > = {};
    for (const b of backends) {
      const s = this.state(b);
      const now = Date.now();
      out[b] = {
        open: now < s.openUntil || (s.halfOpen && s.probing),
        halfOpen: s.halfOpen,
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
