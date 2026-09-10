import test from "node:test";
import assert from "node:assert/strict";
import { startSpan, withSpan } from "../../dist/observability/tracing.js";

test("startSpan is no-op when tracing disabled", () => {
  delete process.env.OTEL_LOG_SPANS;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const span = startSpan("test.noop", { a: 1 });
  assert.equal(span.spanId, "0");
  span.setAttribute("b", 2);
  span.end("ok");
});

test("withSpan returns fn result", async () => {
  delete process.env.OTEL_LOG_SPANS;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const out = await withSpan("test.wrap", {}, async () => 42);
  assert.equal(out, 42);
});

test("withSpan rethrows errors", async () => {
  delete process.env.OTEL_LOG_SPANS;
  await assert.rejects(
    () =>
      withSpan("test.err", {}, async () => {
        throw new Error("boom");
      }),
    /boom/
  );
});
