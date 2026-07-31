/**
 * In-process concurrency gate for outbound gateway calls.
 * Free — no Redis/paid queue. Protects Node/Python backends under multi-step workflows.
 */

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
    return () => this.release();
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  stats() {
    return {
      active: this.active,
      waiting: this.waiters.length,
      max: this.max,
    };
  }
}
