import { randomUUID } from "crypto";
import { constants, getEnv } from "../config";
import { circuitBreaker } from "./circuit-breaker";
import type { McpToolRoute } from "../contracts";
import type { Logger } from "../observability/logger";

export interface GatewayInvokeOptions {
  apiKey: string;
  sessionToken?: string;
  requestId?: string;
  mcpSessionId?: string;
  operationId?: string;
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), constants.gatewayTimeoutMs);

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

    if (res.status >= 500) {
      circuitBreaker.recordFailure(backend);
    } else if (res.ok) {
      circuitBreaker.recordSuccess(backend);
    }

    return {
      status: res.status,
      headers: headersToRecord(res.headers),
      data,
      text,
    };
  } catch (e) {
    circuitBreaker.recordFailure(backend);
    throw e;
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
