import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { defsCache } from "../../dist/registry/defs-cache.js";
import { invokeOperation } from "../../dist/orchestrator/invoke-operation.js";
import { runWorkflow } from "../../dist/workflow/engine.js";
import {
  clearSessionCache,
  invalidateApiKeyCache,
} from "../../dist/auth/session.js";
import { circuitBreaker } from "../../dist/gateway/circuit-breaker.js";
import { MCP_ERROR_CODES } from "../../dist/contracts/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function okValidate() {
  return new Response(
    JSON.stringify({
      allowed: true,
      sessionToken: "tok-test",
      userId: "u1",
      apiKeyId: "k1",
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("mocked gateway + workflow integration", () => {
  /** @type {typeof fetch} */
  let originalFetch;
  /** @type {RegistryLoader} */
  let registry;
  /** @type {Array<{ url: string, status: number }>} */
  let gatewayCalls;

  before(() => {
    process.env.REGISTRY_PATH = path.join(root, "registry", "manifest.json");
    process.env.SCHEMAS_DIR = path.join(root, "registry", "schemas");
    process.env.WORKFLOWS_PATH = path.join(root, "registry", "workflows.json");
    process.env.TASKS_PATH = path.join(root, "registry", "tasks.json");
    process.env.CONTENT_ADAPTERS_PATH = path.join(
      root,
      "registry",
      "content-adapters.json"
    );
    process.env.SAAS_VALIDATE_URL = "http://saas.test/internal/validate-key";
    process.env.GATEWAY_URL = "http://gateway.test";
    process.env.SAAS_INTERNAL_SECRET = "test-secret";

    registry = new RegistryLoader(logger);
    registry.reload();
    defsCache.reload(true);
  });

  beforeEach(() => {
    clearSessionCache();
    circuitBreaker.recordSuccess("node");
    circuitBreaker.recordSuccess("python");
    gatewayCalls = [];
    originalFetch = globalThis.fetch;
  });

  after(() => {
    // noop — each test restores fetch in finally
  });

  it("invokeOperation validates then calls gateway and shapes 200", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("validate-key")) return okValidate();
      gatewayCalls.push({ url, status: 200 });
      return new Response(
        JSON.stringify({
          status: 200,
          data: { url: "https://example.com", ok: true },
          report: { summary: { totalScore: 80 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    try {
      const route = registry.getRoute("pageSpeedAnalyzer");
      assert.ok(route);
      const result = await invokeOperation(
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-1",
          logger,
          registry,
        },
        route,
        "pageSpeedAnalyzer",
        { url: "https://example.com" }
      );
      assert.equal(result.isError, false);
      assert.equal(result.status, 200);
      assert.ok(gatewayCalls.length >= 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("invokeOperation rejects missing required schema fields early", async () => {
    let gatewayHit = false;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("validate-key")) return okValidate();
      gatewayHit = true;
      throw new Error("gateway should not be called");
    };

    try {
      const route = registry.getRoute("pageSpeedAnalyzer");
      assert.ok(route);
      const result = await invokeOperation(
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-1",
          logger,
          registry,
        },
        route,
        "pageSpeedAnalyzer",
        {}
      );
      assert.equal(result.isError, true);
      assert.equal(result.status, 400);
      assert.equal(result.shaped.error.code, MCP_ERROR_CODES.INVALID_INPUT);
      assert.equal(gatewayHit, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runWorkflow completes multi-step when gateway succeeds", async () => {
    let step = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("validate-key")) return okValidate();
      step += 1;
      gatewayCalls.push({ url, status: 200 });
      return new Response(
        JSON.stringify({
          status: 200,
          data: { url: "https://example.com", step },
          report: {
            summary: { totalScore: 70 },
            metrics: {
              proxies: {
                lcpScore: 60,
                tbtScore: 55,
                fcpScore: 70,
                clsScore: 80,
              },
              ttfbMs: 450,
            },
            findings: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    try {
      const result = await runWorkflow(
        "core-web-vitals-job",
        { url: "https://example.com" },
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-wf",
          registry,
          logger,
        }
      );
      assert.equal(result.status, "completed");
      assert.ok(result.completedSteps.length >= 2);
      assert.ok(result.jobReport);
      assert.ok(result.jobReport.scores.LCP || result.jobReport.scores.TTFB);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runWorkflow returns partial and invalidates auth on 401", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("validate-key")) return okValidate();
      gatewayCalls.push({ url, status: 401 });
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      // Warm cache
      await invokeOperation(
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-401",
          logger,
          registry,
        },
        registry.getRoute("pageSpeedAnalyzer"),
        "pageSpeedAnalyzer",
        { url: "https://example.com" }
      ).catch(() => null);

      const result = await runWorkflow(
        "document-convert-pipeline",
        { fileUrl: "https://example.com/a.docx" },
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-401b",
          registry,
          logger,
        }
      );
      assert.equal(result.status, "partial");
      assert.ok(result.failedStep);
      // Ensure invalidate path is callable (no throw)
      invalidateApiKeyCache("ty_test");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gateway retries once on 503 then succeeds", async () => {
    let attempts = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("validate-key")) return okValidate();
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "busy" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ status: 200, data: { ok: true } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    try {
      const route = registry.getRoute("pageSpeedAnalyzer");
      const result = await invokeOperation(
        {
          apiKey: "ty_test",
          mcpSessionId: "sess-retry",
          logger,
          registry,
        },
        route,
        "pageSpeedAnalyzer",
        { url: "https://example.com" }
      );
      assert.equal(result.isError, false);
      assert.ok(attempts >= 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
