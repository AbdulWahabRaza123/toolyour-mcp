import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capOverallBySiblingScores,
  markIncompleteJobReport,
} from "../../dist/jobs/utils.js";
import { computeVerifyGate } from "../../dist/orchestrator/job-report.js";
import { shapeAgentResult } from "../../dist/orchestrator/harness-loop.js";
import { solveTask } from "../../dist/orchestrator/solve-task.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";
import { synthesizeJobReport } from "../../dist/jobs/synthesize.js";

describe("overall score honesty", () => {
  it("caps overall good when a sibling score is poor", () => {
    const scores = capOverallBySiblingScores({
      overall: { label: "Ship", value: 90, status: "good" },
      securityHeaders: { label: "Headers", value: 20, status: "poor" },
      tls: { label: "TLS", value: "ok", status: "good" },
    });
    assert.equal(scores.overall.status, "poor");
  });

  it("markIncomplete demotes good scores and fails the gate", () => {
    const report = markIncompleteJobReport(
      {
        schemaVersion: "toolyour.jobReport@1",
        jobId: "ship-gate-job",
        workflowId: "ship-gate-job",
        summary: ["Ready for a human smoke test."],
        scores: {
          overall: { label: "Ship", value: 90, status: "good" },
          securityHeaders: { label: "Headers", value: "—", status: "unknown" },
        },
        findings: [],
        prioritizedActions: [],
        toolsUsed: [],
        steps: {},
      },
      "Workflow stopped early."
    );
    assert.equal(report.incomplete, true);
    assert.match(report.summary[0], /INCOMPLETE/i);
    assert.equal(report.scores.overall.status, "unknown");
    assert.equal(computeVerifyGate(report), "fail");
    assert.equal(report.summary.some((s) => /look acceptable/i.test(s)), false);
  });
});

describe("localhost pre-block", () => {
  it("solve_task refuses localhost ship-gate before invoke", async () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const result = await solveTask(
      "ship gate for http://localhost:3000",
      { url: "http://localhost:3000" },
      {
        apiKey: "ty_test",
        mcpSessionId: "test",
        registry,
        logger: createLogger("error"),
      }
    );
    assert.equal(result.status, "need_input");
    assert.equal(result.code, "local_preview_required");
    assert.match(String(result.message || result.hint || ""), /localhost/i);
    assert.equal(result.loop?.initiate, false);
  });
});

describe("CWV incomplete honesty", () => {
  it("does not claim metrics look acceptable when SEO step is missing", () => {
    const report = synthesizeJobReport({
      synthesizerId: "core-web-vitals",
      workflowId: "core-web-vitals-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "speed", operationId: "pageSpeedAnalyzer" },
        { id: "seo", operationId: "seoAnalyze" },
        { id: "social", operationId: "socialMediaPreviewChecker" },
      ],
      stepResults: {
        speed: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: {
              summary: { totalScore: 88 },
              metrics: {
                proxies: { lcpScore: 90, tbtScore: 85, clsScore: 92 },
                ttfbMs: 200,
              },
              findings: [],
            },
          },
        },
      },
    });
    assert.equal(report.summary.some((s) => /look acceptable/i.test(s)), false);
    assert.ok(report.summary.some((s) => /Incomplete|missing SEO/i.test(s)));
  });

  it("warns when thin HTML proxies look strong", () => {
    const report = synthesizeJobReport({
      synthesizerId: "core-web-vitals",
      workflowId: "core-web-vitals-job",
      input: { url: "https://example.com" },
      steps: [{ id: "speed", operationId: "pageSpeedAnalyzer" }],
      stepResults: {
        speed: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: {
              summary: { totalScore: 95 },
              metrics: {
                proxies: { lcpScore: 95, tbtScore: 90, clsScore: 98 },
                ttfbMs: 120,
              },
              evidence: { assetOptimizer: { compressImages: [], deferScripts: [] } },
              findings: [],
            },
          },
        },
      },
    });
    assert.ok(report.summary.some((s) => /thin HTML|CrUX|Lighthouse/i.test(s)));
    assert.ok(
      (report.limitations || []).some((l) => /Thin or mostly-static HTML/i.test(l))
    );
  });
});

describe("partial envelope copy", () => {
  it("uses incomplete loop reason, not gate pass", () => {
    const shaped = shapeAgentResult(
      {
        status: "partial",
        execution: {
          status: "partial",
          workflowId: "ship-gate-job",
          jobReport: markIncompleteJobReport({
            schemaVersion: "toolyour.jobReport@1",
            jobId: "ship-gate-job",
            workflowId: "ship-gate-job",
            gatePolicy: "ship",
            summary: ["ok"],
            scores: {
              overall: { label: "s", value: 90, status: "good" },
              securityHeaders: { label: "h", value: 90, status: "good" },
              tls: { label: "t", value: "ok", status: "good" },
              mixedContent: { label: "m", value: 90, status: "good" },
              httpStatus: { label: "http", value: 100, status: "good" },
              performance: { label: "p", value: 70, status: "needs_improvement" },
            },
            findings: [],
            prioritizedActions: [],
            toolsUsed: [],
            steps: {},
          }),
        },
      },
      "compact"
    );
    assert.equal(shaped.loop.gate, "fail");
    assert.equal(shaped.loop.initiate, false);
    assert.match(String(shaped.loop.next), /incomplete|partial|re-run/i);
    assert.equal(/gate pass/i.test(String(shaped.loop.next)), false);
    assert.ok(shaped.loop.receipt);
  });
});
