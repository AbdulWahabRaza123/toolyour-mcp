/**
 * Lightweight open tracing for ToolYour MCP.
 *
 * - Default: no-op (zero overhead in production unless enabled)
 * - OTEL_LOG_SPANS=1 → JSON spans on stdout (open, vendor-neutral)
 * - OTEL_EXPORTER_OTLP_ENDPOINT → OTLP/HTTP JSON export (works with
 *   OpenTelemetry Collector, Jaeger, Grafana Tempo — no proprietary APM required)
 *
 * Does not pull @opentelemetry/* packages; keep the gateway dependency-light.
 */
import { randomUUID } from "crypto";

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

export interface SpanHandle {
  name: string;
  traceId: string;
  spanId: string;
  startMs: number;
  setAttribute(key: string, value: string | number | boolean | undefined): void;
  end(status?: "ok" | "error", errMessage?: string): void;
}

function tracingEnabled(): boolean {
  return (
    process.env.OTEL_LOG_SPANS === "1" ||
    process.env.OTEL_LOG_SPANS === "true" ||
    !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  );
}

function otlpEndpoint(): string | undefined {
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!base) return undefined;
  // Accept collector root or full traces path
  if (base.includes("/v1/traces")) return base.replace(/\/$/, "");
  return `${base.replace(/\/$/, "")}/v1/traces`;
}

function toNano(ms: number): string {
  return String(BigInt(Math.floor(ms)) * 1000000n);
}

async function exportOtlp(span: {
  name: string;
  traceId: string;
  spanId: string;
  startMs: number;
  endMs: number;
  status: "ok" | "error";
  errMessage?: string;
  attributes: SpanAttributes;
}): Promise<void> {
  const endpoint = otlpEndpoint();
  if (!endpoint) return;

  const attrs = Object.entries(span.attributes)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => {
      if (typeof value === "number") {
        return { key, value: { doubleValue: value } };
      }
      if (typeof value === "boolean") {
        return { key, value: { boolValue: value } };
      }
      return { key, value: { stringValue: String(value) } };
    });

  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "toolyour-mcp" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "toolyour-mcp", version: process.env.MCP_SERVER_VERSION || "1.0.0" },
            spans: [
              {
                traceId: span.traceId.replace(/-/g, "").padEnd(32, "0").slice(0, 32),
                spanId: span.spanId.replace(/-/g, "").slice(0, 16),
                name: span.name,
                kind: 1,
                startTimeUnixNano: toNano(span.startMs),
                endTimeUnixNano: toNano(span.endMs),
                attributes: attrs,
                status: {
                  code: span.status === "error" ? 2 : 1,
                  message: span.errMessage || "",
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Never break the MCP request path for telemetry failures
  }
}

export function startSpan(
  name: string,
  attributes: SpanAttributes = {},
  parentTraceId?: string
): SpanHandle {
  if (!tracingEnabled()) {
    return {
      name,
      traceId: parentTraceId || "0",
      spanId: "0",
      startMs: 0,
      setAttribute() {},
      end() {},
    };
  }

  const attrs: SpanAttributes = { ...attributes };
  const handle: SpanHandle = {
    name,
    traceId: parentTraceId || randomUUID(),
    spanId: randomUUID(),
    startMs: Date.now(),
    setAttribute(key, value) {
      attrs[key] = value;
    },
    end(status: "ok" | "error" = "ok", errMessage?: string) {
      const endMs = Date.now();
      const durationMs = endMs - handle.startMs;
      if (
        process.env.OTEL_LOG_SPANS === "1" ||
        process.env.OTEL_LOG_SPANS === "true"
      ) {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            type: "span",
            name: handle.name,
            traceId: handle.traceId,
            spanId: handle.spanId,
            durationMs,
            status,
            errMessage: errMessage || undefined,
            attributes: attrs,
          })
        );
      }
      void exportOtlp({
        name: handle.name,
        traceId: handle.traceId,
        spanId: handle.spanId,
        startMs: handle.startMs,
        endMs,
        status,
        errMessage,
        attributes: { ...attrs, "duration.ms": durationMs },
      });
    },
  };
  return handle;
}

export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: SpanHandle) => Promise<T>
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const out = await fn(span);
    span.end("ok");
    return out;
  } catch (err) {
    span.end("error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
