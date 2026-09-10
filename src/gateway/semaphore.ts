/**
 * In-process concurrency gate for outbound gateway calls.
 * Free — no Redis/paid queue. Protects Node/Python backends under multi-step workflows.
 */

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  /**
   * @param timeoutMs optional fail-fast wait (scale: avoid unbounded MCP hangs)
   */
  async acquire(timeoutMs?: number): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: (typeof this.waiters)[number] = {
        resolve: (release) => {
          if (entry.timer) clearTimeout(entry.timer);
          resolve(release);
        },
        reject: (err) => {
          if (entry.timer) clearTimeout(entry.timer);
          reject(err);
        },
      };
      if (timeoutMs != null && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(entry);
          if (idx >= 0) this.waiters.splice(idx, 1);
          entry.reject(
            Object.assign(new Error("Gateway concurrency wait timed out"), {
              code: "gateway_busy",
              retryable: true,
              retryAfterMs: 1000,
            })
          );
        }, timeoutMs);
      }
      this.waiters.push(entry);
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) {
      this.active += 1;
      next.resolve(() => this.release());
    }
  }

  stats() {
    return {
      active: this.active,
      waiting: this.waiters.length,
      max: this.max,
    };
  }
}
