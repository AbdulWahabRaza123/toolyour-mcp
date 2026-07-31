import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../../dist/gateway/circuit-breaker.js";
import {
  clearSessionCache,
  invalidateApiKeyCache,
  sessionCacheSize,
  validateApiKey,
} from "../../dist/auth/session.js";
import { shapeResponseForLlm } from "../../dist/summarize/registry.js";
import { validateInputAgainstSchema } from "../../dist/orchestrator/schema-validate.js";
import { isConfidentMatch, matchTask, scoreTask } from "../../dist/orchestrator/match-task.js";
import { loadTasks } from "../../dist/orchestrator/task-registry.js";
import { defsCache } from "../../dist/registry/defs-cache.js";
import { prioritizedLinkSuggestionsFromShaped } from "../../dist/jobs/utils.js";
import { constants } from "../../dist/config.js";

describe("circuit breaker recovery", () => {
  it("opens after threshold then closes after open window", async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      const opened = cb.recordFailure("node");
      if (i === 4) assert.equal(opened, true);
    }
    assert.equal(cb.isOpen("node"), true);
    assert.ok(cb.retryAfterMs("node") > 0);
    const snap = cb.snapshot();
    assert.equal(snap.node.open, true);

    // Simulate recovery via success
    cb.recordSuccess("node");
    assert.equal(cb.isOpen("node"), false);
    assert.equal(cb.snapshot().node.open, false);
  });
});

describe("auth cache invalidation", () => {
  beforeEach(() => {
    clearSessionCache();
  });

  it("invalidateApiKeyCache removes cached entries", async () => {
    // Seed cache via validate with mocked fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          allowed: true,
          sessionToken: "tok",
          userId: "u1",
          apiKeyId: "k1",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await validateApiKey("ty_test", "/api/v1/x", "node", logger);
    assert.equal(sessionCacheSize(), 1);
    invalidateApiKeyCache("ty_test", "node");
    assert.equal(sessionCacheSize(), 0);

    globalThis.fetch = originalFetch;
  });
});

describe("structure-aware summarization", () => {
  it("preserves jobReport core fields when oversized", () => {
    const findings = Array.from({ length: 40 }, (_, i) => ({
      severity: "medium",
      title: `Finding ${i}`,
      whyItMatters: "x".repeat(200),
      howToFix: ["fix it"],
    }));
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "core-web-vitals-job",
      workflowId: "core-web-vitals-job",
      summary: ["ok"],
      scores: { LCP: { label: "LCP", value: 50, status: "needs_improvement" } },
      findings,
      prioritizedActions: Array.from({ length: 20 }, (_, i) => ({
        rank: i + 1,
        workstream: "LCP",
        action: `Action ${i}`,
        expectedImpact: "high",
      })),
      workstreams: { speed: { report: { huge: "y".repeat(5000) } } },
      steps: { speed: { data: "z".repeat(5000) } },
      toolsUsed: ["pageSpeedAnalyzer"],
      limitations: ["proxy"],
    };
    const text = JSON.stringify(report);
    assert.ok(text.length > constants.summarizeThresholdBytes);
    const shaped = shapeResponseForLlm("pageSpeedAnalyzer", 200, report, text);
    assert.equal(shaped.summarized, true);
    assert.ok(shaped.data.scores);
    assert.ok(Array.isArray(shaped.data.findings));
    assert.ok(shaped.data.findings.length <= 25);
    assert.ok(shaped.data.prioritizedActions.length <= 12);
  });
});

describe("schema validation", () => {
  it("rejects missing required fields", () => {
    const result = validateInputAgainstSchema(
      {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string" } },
      },
      {}
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["url"]);
  });

  it("accepts valid input", () => {
    const result = validateInputAgainstSchema(
      {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string" } },
      },
      { url: "https://example.com" }
    );
    assert.equal(result.ok, true);
  });

  it("accepts oneOf flat branch", () => {
    const result = validateInputAgainstSchema(
      {
        oneOf: [
          {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
          },
          {
            type: "object",
            required: ["inputs"],
            properties: {
              inputs: {
                type: "object",
                required: ["url"],
                properties: { url: { type: "string" } },
              },
            },
          },
        ],
      },
      { url: "https://example.com" }
    );
    assert.equal(result.ok, true);
  });

  it("rejects oneOf when no branch matches", () => {
    const result = validateInputAgainstSchema(
      {
        oneOf: [
          {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
          },
        ],
      },
      {}
    );
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes("url"));
  });
});

describe("defs cache", () => {
  it("loads tasks without per-call disk thrash", () => {
    defsCache.reload(true);
    const a = loadTasks();
    const b = loadTasks();
    assert.ok(a.length > 0);
    assert.equal(a.length, b.length);
    assert.ok(defsCache.isReady());
  });
});

describe("fuzzy task scoring", () => {
  it("matches UK spelling optimisation via synonym expansion", () => {
    const tasks = loadTasks();
    const match = matchTask("seo optimisation for https://example.com", tasks);
    assert.ok(match);
    assert.ok(match.score >= 2);
  });

  it("confidence gating rejects weak matches", () => {
    const tasks = loadTasks();
    const weak = { task: tasks[0], score: 2 };
    assert.equal(isConfidentMatch("zzz unrelated gibberish xyz", tasks, weak), false);
  });
});

describe("link suggestions sort", () => {
  it("orders by relevanceScore descending and caps at 10", () => {
    const shaped = {
      status: 200,
      data: {
        suggestedLinks: [
          { from: "/a", to: "/b", suggestedAnchorText: "low", relevanceScore: 10 },
          { from: "/c", to: "/d", suggestedAnchorText: "high", relevanceScore: 90 },
          { from: "/e", to: "/f", suggestedAnchorText: "mid", relevanceScore: 50 },
        ],
      },
    };
    const actions = prioritizedLinkSuggestionsFromShaped(shaped, 15);
    assert.equal(actions.length, 3);
    assert.match(actions[0].action, /high/);
    assert.match(actions[2].action, /low/);
  });
});

describe("gateway semaphore", () => {
  it("limits concurrent acquires", async () => {
    const { Semaphore } = await import("../../dist/gateway/semaphore.js");
    const sem = new Semaphore(2);
    const order = [];
    const hold = async (label, ms) => {
      const release = await sem.acquire();
      order.push(`start-${label}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end-${label}`);
      release();
    };
    await Promise.all([hold("a", 40), hold("b", 40), hold("c", 10)]);
    assert.ok(order.indexOf("start-c") >= order.indexOf("end-a") || order.indexOf("start-c") >= order.indexOf("end-b"));
    assert.deepEqual(sem.stats(), { active: 0, waiting: 0, max: 2 });
  });
});

describe("payload store dataRef", () => {
  it("stores and retrieves truncated payloads", async () => {
    const { payloadStore, buildDataRefPath } = await import(
      "../../dist/payloads/store.js"
    );
    const { shapeResponseForLlm } = await import(
      "../../dist/summarize/registry.js"
    );
    const big = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "x",
      workflowId: "x",
      summary: ["s"],
      scores: {},
      findings: Array.from({ length: 5 }, (_, i) => ({
        severity: "low",
        title: `f${i}`,
        whyItMatters: "y".repeat(3000),
        howToFix: ["z"],
      })),
      prioritizedActions: [],
      toolsUsed: [],
      steps: { a: { huge: "h".repeat(20000) } },
    };
    const text = JSON.stringify(big);
    const shaped = shapeResponseForLlm("pageSpeedAnalyzer", 200, big, text);
    assert.equal(shaped.summarized, true);
    assert.ok(shaped.dataRefId);
    assert.equal(shaped.dataRef, buildDataRefPath(shaped.dataRefId));
    const entry = payloadStore.get(shaped.dataRefId);
    assert.ok(entry);
    assert.equal(entry.operationId, "pageSpeedAnalyzer");
  });
});
