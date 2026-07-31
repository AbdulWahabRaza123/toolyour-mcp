import { constants, getEnv } from "../config";
import type { Logger } from "../observability/logger";
import { incr } from "../observability/counters";

export interface SessionData {
  sessionToken: string;
  userId: string;
  apiKeyId: string;
  cachedAt: number;
}

const cache = new Map<string, SessionData>();

function cacheKey(apiKey: string, backend: string): string {
  return `${apiKey}:${backend}`;
}

export async function validateApiKey(
  apiKey: string,
  toolOrPath: string,
  backend: string,
  logger: Logger
): Promise<SessionData> {
  const key = cacheKey(apiKey, backend);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.cachedAt < constants.sessionCacheTtlSeconds * 1000) {
    incr("authCacheHits");
    return hit;
  }

  incr("authCacheMisses");
  const env = getEnv();
  const res = await fetch(env.validateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SaaS-Secret": env.internalSecret,
    },
    body: JSON.stringify({ apiKey, backend, toolOrPath }),
  });

  const body = (await res.json()) as {
    allowed?: boolean;
    reason?: string;
    sessionToken?: string;
    userId?: string;
    apiKeyId?: string;
  };

  if (!res.ok || !body.allowed || !body.sessionToken) {
    logger.warn("validate-key denied", { reason: body.reason });
    invalidateApiKeyCache(apiKey, backend);
    throw Object.assign(new Error(body.reason || "Unauthorized"), {
      code: "unauthorized",
    });
  }

  const session: SessionData = {
    sessionToken: body.sessionToken,
    userId: body.userId || "",
    apiKeyId: body.apiKeyId || "",
    cachedAt: Date.now(),
  };
  cache.set(key, session);
  return session;
}

/** Drop cached sessions for a key (all backends, or one backend). */
export function invalidateApiKeyCache(apiKey: string, backend?: string) {
  if (backend) {
    cache.delete(cacheKey(apiKey, backend));
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(`${apiKey}:`)) cache.delete(k);
  }
}

export function clearSessionCache() {
  cache.clear();
}

/** Test helper: peek cache size */
export function sessionCacheSize(): number {
  return cache.size;
}
