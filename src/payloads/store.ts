import { randomUUID } from "crypto";
import { constants } from "../config";
import { incr } from "../observability/counters";

export interface StoredPayload {
  id: string;
  operationId: string;
  data: unknown;
  createdAt: number;
  expiresAt: number;
  bytes: number;
}

interface Entry extends StoredPayload {
  /* marker */
}

/**
 * Process-local TTL store for truncated MCP responses.
 * No paid blob/CDN — agents fetch via dataRef or fetch_payload.
 * Multi-replica: each instance has its own store (sticky session / same instance).
 */
class PayloadStore {
  private entries = new Map<string, Entry>();
  private totalBytes = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(
      () => this.sweep(),
      constants.dataRefSweepMs
    );
    this.sweepTimer.unref?.();
  }

  stop() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  store(operationId: string, data: unknown): StoredPayload {
    this.sweep();
    const text = JSON.stringify(data);
    const bytes = text.length;

    // Evict oldest until under budget
    while (
      (this.entries.size >= constants.dataRefMaxEntries ||
        this.totalBytes + bytes > constants.dataRefMaxTotalBytes) &&
      this.entries.size > 0
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }

    const id = randomUUID();
    const now = Date.now();
    const entry: Entry = {
      id,
      operationId,
      data,
      createdAt: now,
      expiresAt: now + constants.dataRefTtlMs,
      bytes,
    };
    this.entries.set(id, entry);
    this.totalBytes += bytes;
    incr("dataRefsStored");
    return entry;
  }

  get(id: string): StoredPayload | null {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.delete(id);
      return null;
    }
    incr("dataRefsFetched");
    return entry;
  }

  delete(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
  }

  sweep() {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (now >= entry.expiresAt) this.delete(id);
    }
  }

  stats() {
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      maxEntries: constants.dataRefMaxEntries,
      maxTotalBytes: constants.dataRefMaxTotalBytes,
      ttlMs: constants.dataRefTtlMs,
    };
  }
}

export const payloadStore = new PayloadStore();

/** Public relative path agents can open with the same API key. */
export function buildDataRefPath(id: string): string {
  return `/mcp/payloads/${id}`;
}
