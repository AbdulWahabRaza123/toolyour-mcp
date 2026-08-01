import { randomUUID } from "crypto";
import { constants } from "../config";

export type RunStatus = "accepted" | "running" | "completed" | "partial" | "error";

export interface StoredRun {
  id: string;
  userId: string;
  apiKeyId: string;
  kind: "solve_task" | "run_playbook" | "run_workflow" | "verify_task";
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  result?: unknown;
  error?: unknown;
  bytes: number;
}

const RUN_TTL_MS = 60 * 60 * 1000;
const RUN_MAX_ENTRIES = 200;
const RUN_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/**
 * Process-local TTL store for async MCP runs.
 * Multi-replica: each instance has its own store (same sticky limitation as dataRef).
 */
class RunStore {
  private entries = new Map<string, StoredRun>();
  private totalBytes = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), constants.dataRefSweepMs);
    this.sweepTimer.unref?.();
  }

  stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  create(partial: {
    userId: string;
    apiKeyId: string;
    kind: StoredRun["kind"];
  }): StoredRun {
    this.sweep();
    while (
      (this.entries.size >= RUN_MAX_ENTRIES ||
        this.totalBytes > RUN_MAX_TOTAL_BYTES) &&
      this.entries.size > 0
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }

    const now = Date.now();
    const entry: StoredRun = {
      id: randomUUID(),
      userId: partial.userId,
      apiKeyId: partial.apiKeyId,
      kind: partial.kind,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + RUN_TTL_MS,
      bytes: 0,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  markRunning(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.status = "running";
    entry.updatedAt = Date.now();
  }

  finish(
    id: string,
    status: "completed" | "partial" | "error",
    result: unknown,
    error?: unknown
  ) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    const text = JSON.stringify(result ?? error ?? null);
    entry.status = status;
    entry.result = result;
    entry.error = error;
    entry.bytes = text.length;
    entry.updatedAt = Date.now();
    entry.expiresAt = Date.now() + RUN_TTL_MS;
    this.totalBytes += entry.bytes;
    return entry;
  }

  get(id: string): StoredRun | null {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.delete(id);
      return null;
    }
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
      ttlMs: RUN_TTL_MS,
    };
  }
}

export const runStore = new RunStore();

export function buildRunPath(id: string): string {
  return `/mcp/runs/${id}`;
}
