import type { Logger } from "../observability/logger";
import { resolveRedisUrl } from "./redis-url";
import type { StoredRun } from "./store";

const KEY_PREFIX = "ty:mcp:run:";
const TTL_SECONDS = 60 * 60;

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: string, cb: (...args: unknown[]) => void): void;
};

let client: RedisLike | null = null;
let connectAttempted = false;
let redisEnabled = false;

function keyFor(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/**
 * Best-effort Redis connect. Never throws to callers — missing/broken Redis = memory-only.
 */
export async function startRedisRuns(logger: Logger): Promise<boolean> {
  if (connectAttempted) return redisEnabled;
  connectAttempted = true;

  const url = resolveRedisUrl();
  if (!url) {
    logger.info("mcp run store: memory only (REDIS_URL not set)");
    return false;
  }

  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5_000,
    });
    redis.on("error", (err: Error) => {
      logger.warn("mcp redis error (runs fall back to memory)", {
        error: err.message,
      });
    });
    await redis.connect();
    client = redis as unknown as RedisLike;
    redisEnabled = true;
    logger.info("mcp run store: redis + memory (multi-replica get_run enabled)");
    return true;
  } catch (e) {
    client = null;
    redisEnabled = false;
    logger.warn("mcp redis connect failed — using in-process run store only", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export function isRedisRunsEnabled(): boolean {
  return redisEnabled && !!client;
}

export async function redisPutRun(run: StoredRun): Promise<void> {
  if (!client || !redisEnabled) return;
  try {
    const ttlSec = Math.max(
      1,
      Math.ceil((run.expiresAt - Date.now()) / 1000) || TTL_SECONDS
    );
    await client.set(keyFor(run.id), JSON.stringify(run), "EX", ttlSec);
  } catch {
    /* ignore — memory remains source for this instance */
  }
}

export async function redisGetRun(id: string): Promise<StoredRun | null> {
  if (!client || !redisEnabled) return null;
  try {
    const raw = await client.get(keyFor(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRun;
    if (!parsed?.id || Date.now() >= parsed.expiresAt) {
      void client.del(keyFor(id));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function stopRedisRuns(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* ignore */
  }
  client = null;
  redisEnabled = false;
}
