import { constants, getEnv } from "../config";
import type { Logger } from "../observability/logger";

export interface SessionData {
  sessionToken: string;
  userId: string;
  apiKeyId: string;
  cachedAt: number;
}

const cache = new Map<string, SessionData>();

export async function validateApiKey(
  apiKey: string,
  toolOrPath: string,
  backend: string,
  logger: Logger
): Promise<SessionData> {
  const cacheKey = `${apiKey}:${backend}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.cachedAt < constants.sessionCacheTtlSeconds * 1000) {
    return hit;
  }

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
  cache.set(cacheKey, session);
  return session;
}

export function clearSessionCache() {
  cache.clear();
}
