import { constants, getEnv } from "../config";
import type { Logger } from "../observability/logger";
import { incr } from "../observability/counters";
import { randomUUID } from "crypto";

export interface SessionData {
  sessionToken: string;
  userId: string;
  apiKeyId: string;
  cachedAt: number;
  /** From SaaS ApiKey.controlPlane — required for job_* when jobs backend is saas. */
  controlPlane: boolean;
}

const cache = new Map<string, SessionData>();
/** In-flight validate-key promises — prevents stampede on cold cache / TTL expiry. */
const inflight = new Map<string, Promise<SessionData>>();
const oauthSessions = new Map<string, SessionData & { expiresAt: number }>();

const VALIDATE_TIMEOUT_MS = 5_000;
const SESSION_CACHE_MAX_ENTRIES = 2_000;

function cacheKey(apiKey: string, backend: string): string {
  return `${apiKey}:${backend}`;
}

function evictExpiredAndCap(): void {
  const ttlMs = constants.sessionCacheTtlSeconds * 1000;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.cachedAt >= ttlMs) cache.delete(k);
  }
  while (cache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchValidateKey(
  apiKey: string,
  toolOrPath: string,
  backend: string,
  logger: Logger
): Promise<SessionData> {
  const env = getEnv();
  const res = await fetch(env.validateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SaaS-Secret": env.internalSecret,
    },
    body: JSON.stringify({ apiKey, backend, toolOrPath }),
    signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
  });

  const body = (await res.json()) as {
    allowed?: boolean;
    reason?: string;
    sessionToken?: string;
    userId?: string;
    apiKeyId?: string;
    controlPlane?: boolean;
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
    controlPlane: body.controlPlane === true,
  };
  evictExpiredAndCap();
  cache.set(cacheKey(apiKey, backend), session);
  return session;
}

export async function validateApiKey(
  apiKey: string,
  toolOrPath: string,
  backend: string,
  logger: Logger
): Promise<SessionData> {
  const oauth = oauthSessions.get(apiKey);
  if (oauth) {
    if (oauth.expiresAt > Date.now()) {
      return oauth;
    }
    oauthSessions.delete(apiKey);
  }
  const key = cacheKey(apiKey, backend);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.cachedAt < constants.sessionCacheTtlSeconds * 1000) {
    incr("authCacheHits");
    return hit;
  }

  const pending = inflight.get(key);
  if (pending) {
    incr("authCacheHits");
    return pending;
  }

  incr("authCacheMisses");
  const promise = fetchValidateKey(apiKey, toolOrPath, backend, logger).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Drop cached sessions for a key (all backends, or one backend). */
export function invalidateApiKeyCache(apiKey: string, backend?: string) {
  oauthSessions.delete(apiKey);
  if (backend) {
    cache.delete(cacheKey(apiKey, backend));
    inflight.delete(cacheKey(apiKey, backend));
    return;
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${apiKey}:`)) cache.delete(k);
  }
  for (const k of [...inflight.keys()]) {
    if (k.startsWith(`${apiKey}:`)) inflight.delete(k);
  }
}

export function clearSessionCache() {
  cache.clear();
  inflight.clear();
  oauthSessions.clear();
}

export interface OAuthSessionExchange {
  credential: string;
  session: SessionData;
  subject: string;
  expiresAt: number;
}

/** Exchange a validated Auth0 access token for a short-lived ToolYour session. */
export async function exchangeOAuthAccessToken(
  accessToken: string,
  logger: Logger,
  existingCredential?: string
): Promise<OAuthSessionExchange> {
  const env = getEnv();
  const res = await fetch(env.oauthExchangeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SaaS-Secret": env.internalSecret,
    },
    body: JSON.stringify({ accessToken }),
    signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
  });
  const body = (await res.json()) as {
    allowed?: boolean;
    reason?: string;
    subject?: string;
    sessionToken?: string;
    userId?: string;
    apiKeyId?: string;
    controlPlane?: boolean;
    expiresIn?: number;
  };
  if (!res.ok || !body.allowed || !body.sessionToken || !body.userId || !body.apiKeyId) {
    logger.warn("oauth session exchange denied", {
      status: res.status,
      reason: body.reason || "unauthorized",
    });
    throw Object.assign(new Error(body.reason || "Unauthorized"), {
      code: "unauthorized",
    });
  }

  const credential = existingCredential || `oauth_${randomUUID()}`;
  const expiresAt = Date.now() + Math.max(60, Number(body.expiresIn || 600)) * 1000;
  const session: SessionData = {
    sessionToken: body.sessionToken,
    userId: body.userId,
    apiKeyId: body.apiKeyId,
    cachedAt: Date.now(),
    controlPlane: body.controlPlane === true,
  };
  oauthSessions.set(credential, { ...session, expiresAt });
  return {
    credential,
    session,
    subject: String(body.subject || body.userId),
    expiresAt,
  };
}

/** Test helper: peek cache size */
export function sessionCacheSize(): number {
  return cache.size;
}

/** Test helper: peek in-flight validate count */
export function sessionInflightSize(): number {
  return inflight.size;
}
