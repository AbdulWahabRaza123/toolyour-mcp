import { randomUUID } from "crypto";
import { constants, getEnv } from "../config";
import { circuitBreaker } from "./circuit-breaker";
import { Semaphore } from "./semaphore";
import type { McpToolRoute } from "../contracts";
import type { Logger } from "../observability/logger";
import { incr } from "../observability/counters";

/** Shared across invokes in this process — free backpressure, no paid queue. */
export const gatewaySemaphore = new Semaphore(constants.gatewayMaxConcurrent);

/** Fail fast when waiters pile up under burst (scale). Override via GATEWAY_ACQUIRE_TIMEOUT_MS. */
const ACQUIRE_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.GATEWAY_ACQUIRE_TIMEOUT_MS || 30_000) || 30_000
);

export interface GatewayInvokeOptions {
  apiKey: string;
  sessionToken?: string;
  requestId?: string;
  mcpSessionId?: string;
  operationId?: string;
  mcpTool?: string;
  skillId?: string;
  workflowId?: string;
  body?: unknown;
  formFields?: Record<string, string>;
  query?: Record<string, string>;
  logger: Logger;
}

export interface GatewayInvokeResult {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  text: string;
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** One wait+retry on Free burst 429. Not an env flag. */
const RATE_LIMIT_RETRIES = 1;
const RATE_LIMIT_WAIT_CAP_MS = 60_000;

function quotaKind(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  const nested =
    o.error && typeof o.error === "object"
      ? (o.error as Record<string, unknown>)
      : null;
  return String(o.type || nested?.type || "").toLowerCase();
}

function isRetryableRateLimit(status: number, data: unknown, text: string): boolean {
  if (status !== 429) return false;
  if (quotaKind(data) === "monthly_quota") return false;
  if (quotaKind(data) === "rate_limit") return true;
  return /rate limit|try again in \d+ seconds/i.test(`${text} ${JSON.stringify(data)}`);
}

function rateLimitWaitMs(
  headers: Headers,
  data: unknown
): number {
  const h = headers.get("retry-after");
  if (h && /^\d+$/.test(h.trim())) {
    return Math.min(RATE_LIMIT_WAIT_CAP_MS, Number(h.trim()) * 1000);
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const nested =
      o.error && typeof o.error === "object"
        ? (o.error as Record<string, unknown>)
        : null;
    const n = o.retryAfter ?? nested?.retryAfter;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      return Math.min(RATE_LIMIT_WAIT_CAP_MS, Math.floor(n) * 1000);
    }
  }
  return 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scale-critical: acquire a slot only for the network attempt, then release
 * before sleeping on retry — never hold the semaphore during backoff.
 */
export async function invokeGatewayRoute(
  route: McpToolRoute,
  opts: GatewayInvokeOptions
): Promise<GatewayInvokeResult> {
  const env = getEnv();
  const backend = route.backend;

  if (circuitBreaker.isOpen(backend)) {
    throw Object.assign(new Error("Backend circuit open"), {
      code: "circuit_open",
      retryable: true,
      retryAfterMs: circuitBreaker.retryAfterMs(backend),
    });
  }

  const maxAttempts = 1 + Math.max(0, constants.gatewayRetryCount);
  let lastError: unknown;
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= maxAttempts + RATE_LIMIT_RETRIES; attempt++) {
    if (circuitBreaker.isOpen(backend)) {
      throw Object.assign(new Error("Backend circuit open"), {
        code: "circuit_open",
        retryable: true,
        retryAfterMs: circuitBreaker.retryAfterMs(backend),
      });
    }

    const release = await gatewaySemaphore.acquire(ACQUIRE_TIMEOUT_MS);
    let retryWaitMs = 0;
    try {
      const outcome = await invokeGatewayOnce(route, opts, env, backend, attempt);
      if (outcome.kind === "result") {
        return outcome.result;
      }
      if (outcome.kind === "rate_limit_retry") {
        if (rateLimitRetries >= RATE_LIMIT_RETRIES) {
          incr("invokes");
          return outcome.result;
        }
        rateLimitRetries += 1;
        retryWaitMs = outcome.waitMs;
        incr("gatewayRetries");
        opts.logger.warn("gateway rate limit, retrying", {
          status: outcome.result.status,
          waitMs: retryWaitMs,
          operationId: opts.operationId,
        });
      } else if (outcome.kind === "transient_retry") {
        retryWaitMs = constants.gatewayRetryBackoffMs;
        incr("gatewayRetries");
        opts.logger.warn("gateway transient status, retrying", {
          status: outcome.status,
          attempt,
          operationId: opts.operationId,
        });
      } else if (outcome.kind === "network_retry") {
        retryWaitMs = constants.gatewayRetryBackoffMs;
        lastError = outcome.error;
        incr("gatewayRetries");
        opts.logger.warn("gateway network error, retrying", {
          attempt,
          error:
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error),
          operationId: opts.operationId,
        });
      } else {
        throw outcome.error;
      }
    } finally {
      release();
    }

    if (retryWaitMs > 0) {
      await sleep(retryWaitMs);
      continue;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gateway invoke failed after retries");
}

type OnceOutcome =
  | { kind: "result"; result: GatewayInvokeResult }
  | { kind: "rate_limit_retry"; result: GatewayInvokeResult; waitMs: number }
  | { kind: "transient_retry"; status: number }
  | { kind: "network_retry"; error: unknown }
  | { kind: "network_fail"; error: unknown };

async function invokeGatewayOnce(
  route: McpToolRoute,
  opts: GatewayInvokeOptions,
  env: ReturnType<typeof getEnv>,
  backend: McpToolRoute["backend"],
  attempt: number
): Promise<OnceOutcome> {
  const requestId = opts.requestId || randomUUID();
  const url = new URL(`${env.gatewayUrl}${route.gatewayPath}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "X-Api-Key": opts.apiKey,
    "X-Request-Id": requestId,
    "X-Transport": "mcp",
  };
  if (opts.sessionToken) headers["Authorization"] = `Bearer ${opts.sessionToken}`;
  if (opts.mcpSessionId) headers["X-Mcp-Session-Id"] = opts.mcpSessionId;
  if (opts.operationId) headers["X-Mcp-Operation-Id"] = opts.operationId;
  if (opts.mcpTool) headers["X-Mcp-Tool"] = opts.mcpTool;
  if (opts.skillId) headers["X-Mcp-Skill-Id"] = opts.skillId;
  if (opts.workflowId) headers["X-Mcp-Workflow-Id"] = opts.workflowId;

  let body: BodyInit | undefined;
  if (route.multipart && opts.formFields) {
    const form = new FormData();
    for (const [k, v] of Object.entries(opts.formFields)) {
      form.append(k, v);
    }
    body = form as unknown as BodyInit;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const maxAttempts = 1 + Math.max(0, constants.gatewayRetryCount);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    constants.gatewayTimeoutMs
  );

  try {
    const res = await fetch(url.toString(), {
      method: route.method,
      headers,
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown = text;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json") && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    const result: GatewayInvokeResult = {
      status: res.status,
      headers: headersToRecord(res.headers),
      data,
      text,
    };

    if (isRetryableRateLimit(res.status, data, text)) {
      return {
        kind: "rate_limit_retry",
        result,
        waitMs: rateLimitWaitMs(res.headers, data),
      };
    }

    if (isTransientStatus(res.status) && attempt < maxAttempts) {
      return { kind: "transient_retry", status: res.status };
    }

    if (res.status >= 500) {
      const opened = circuitBreaker.recordFailure(backend);
      if (opened) incr("circuitOpens");
    } else if (res.ok) {
      circuitBreaker.recordSuccess(backend);
    }

    incr("invokes");
    return { kind: "result", result };
  } catch (e) {
    if (attempt < maxAttempts) {
      return { kind: "network_retry", error: e };
    }
    const opened = circuitBreaker.recordFailure(backend);
    if (opened) incr("circuitOpens");
    return { kind: "network_fail", error: e };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkGatewayHealth(): Promise<boolean> {
  const env = getEnv();
  try {
    const res = await fetch(`${env.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
