import { randomUUID } from "crypto";
import { constants } from "../config";
import type { Logger } from "../observability/logger";
import {
  isRedisRunsEnabled,
  redisGetRun,
  redisPutRun,
  startRedisRuns,
  stopRedisRuns,
} from "./redis-backend";

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

export const RUN_TTL_MS = 60 * 60 * 1000;
const RUN_MAX_ENTRIES = 200;
const RUN_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/**
 * Durable async run store: in-process TTL always on; Redis optional for multi-replica get_run.
 * Missing/broken Redis never breaks accept/finish — memory remains authoritative for the writer.
 */
class RunStore {
  private entries = new Map<string, StoredRun>();
  private totalBytes = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger | null = null;

  async start(logger?: Logger) {
    this.logger = logger || null;
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.sweep(), constants.dataRefSweepMs);
      this.sweepTimer.unref?.();
    }
    if (logger) {
      await startRedisRuns(logger);
    }
  }

  async stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    await stopRedisRuns();
  }

  /**
   * Persist accepted run locally and await Redis when enabled so other replicas
   * can poll immediately after accept (no fire-and-forget race).
   */
  async create(partial: {
    userId: string;
    apiKeyId: string;
    kind: StoredRun["kind"];
  }): Promise<StoredRun> {
    this.sweep();
    while (
      (this.entries.size >= RUN_MAX_ENTRIES ||
        this.totalBytes > RUN_MAX_TOTAL_BYTES) &&
      this.entries.size > 0
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.deleteLocal(oldest);
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
    await redisPutRun(entry);
    return entry;
  }

  async markRunning(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.status = "running";
    entry.updatedAt = Date.now();
    await redisPutRun(entry);
  }

  async finish(
    id: string,
    status: "completed" | "partial" | "error",
    result: unknown,
    error?: unknown
  ): Promise<StoredRun | null> {
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
    await redisPutRun(entry);
    return entry;
  }

  /**
   * Local-first, then Redis (cross-replica). Never throws.
   */
  async get(id: string): Promise<StoredRun | null> {
    this.sweep();
    const local = this.entries.get(id);
    if (local) {
      if (Date.now() >= local.expiresAt) {
        this.deleteLocal(id);
      } else {
        return local;
      }
    }
    try {
      const remote = await redisGetRun(id);
      if (remote) {
        this.warmLocal(remote);
        return remote;
      }
    } catch (e) {
      this.logger?.warn("mcp run redis get failed (ignored)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  }

  /** Sync peek for unit tests / same-instance only */
  getLocal(id: string): StoredRun | null {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.deleteLocal(id);
      return null;
    }
    return entry;
  }

  /**
   * True when the session may read this run (same user, or same key if user ids missing).
   */
  ownsRun(
    entry: StoredRun,
    session: { userId: string; apiKeyId: string }
  ): boolean {
    if (entry.userId && session.userId) {
      return entry.userId === session.userId;
    }
    if (entry.apiKeyId && session.apiKeyId) {
      return entry.apiKeyId === session.apiKeyId;
    }
    return false;
  }

  private warmLocal(remote: StoredRun) {
    const existing = this.entries.get(remote.id);
    if (existing) {
      this.totalBytes = Math.max(0, this.totalBytes - existing.bytes);
    }
    this.entries.set(remote.id, remote);
    this.totalBytes += remote.bytes || 0;
  }

  deleteLocal(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
  }

  sweep() {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (now >= entry.expiresAt) this.deleteLocal(id);
    }
  }

  stats() {
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      ttlMs: RUN_TTL_MS,
      redis: isRedisRunsEnabled(),
    };
  }
}

export const runStore = new RunStore();

export function buildRunPath(id: string): string {
  return `/mcp/runs/${id}`;
}
