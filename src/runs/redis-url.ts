/**
 * Resolve Redis URL for MCP async run durability.
 * Returns null when unset — in-process store remains the fallback (no hard dependency).
 *
 * Env: REDIS_URL, REDIS_PUBLIC_URL, or REDISHOST + REDISPASSWORD.
 */
export function isRedisConfigured(): boolean {
  const publicUrl = process.env.REDIS_PUBLIC_URL?.trim();
  const primary = process.env.REDIS_URL?.trim();
  const host = process.env.REDISHOST?.trim();
  const password =
    process.env.REDISPASSWORD?.trim() ||
    process.env.REDIS_PASSWORD?.trim() ||
    "";
  return !!(publicUrl || primary || (host && password));
}

export function resolveRedisUrl(): string | null {
  if (!isRedisConfigured()) return null;

  const publicUrl = process.env.REDIS_PUBLIC_URL?.trim();
  const primary = process.env.REDIS_URL?.trim();
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev && publicUrl) return publicUrl;
  if (primary) return primary;
  if (publicUrl) return publicUrl;

  const host = process.env.REDISHOST?.trim();
  const port = process.env.REDISPORT?.trim() || "6379";
  const user = process.env.REDISUSER?.trim() || "default";
  const password =
    process.env.REDISPASSWORD?.trim() ||
    process.env.REDIS_PASSWORD?.trim() ||
    "";

  if (host && password) {
    return `redis://${user}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return null;
}
