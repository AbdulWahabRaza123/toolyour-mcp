import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyResponseMode } from "../../dist/orchestrator/compact-response.js";
import { planTask } from "../../dist/orchestrator/plan-task.js";
import { diffJobReports, extractJobReport } from "../../dist/orchestrator/verify-task.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";
import { solveTask } from "../../dist/orchestrator/solve-task.js";

describe("compact response mode", () => {
  it("drops duplicated steps when jobReport present", () => {
    const full = {
      status: "completed",
      execution: {
        status: "completed",
        workflowId: "security-headers-job",
        steps: { headers: { huge: true } },
        result: { duplicate: true },
        jobReport: {
          schemaVersion: "toolyour.jobReport@1",
          jobId: "security-headers-job",
          workflowId: "security-headers-job",
          summary: ["ok"],
          scores: { overall: { label: "s", value: 32, status: "poor" } },
          findings: [{ severity: "high", title: "CSP", whyItMatters: "x", howToFix: ["Add CSP"] }],
          prioritizedActions: [],
          toolsUsed: ["securityHeadersAnalyzer"],
          steps: { headers: { raw: true } },
          workstreams: { securityHeaders: { data: { score: 32 } } },
        },
      },
    };
    const compact = applyResponseMode(full, "compact");
    assert.equal(compact.responseMode, "compact");
    assert.equal(compact.execution.steps, undefined);
    assert.equal(compact.execution.result, undefined);
    assert.ok(compact.execution.jobReport);
    assert.equal(compact.execution.jobReport.steps, undefined);
    assert.deepEqual(compact.execution.jobReport.workstreams.securityHeaders, {
      present: true,
    });
  });
});

describe("plan_task", () => {
  it("returns free plan for SEO goal", () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const plan = planTask("SEO audit for https://example.com", {}, registry);
    assert.equal(plan.status, "plan");
    assert.equal(plan.free, true);
    assert.ok(plan.recommended || plan.alternatives.length > 0);
    assert.ok(plan.estimatedCredits >= 0);
  });

  it("does not invent tools for out-of-catalog jokes", () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const plan = planTask("tell me a joke", {}, registry);
    assert.equal(plan.confidence, "none");
    assert.equal(plan.toolHints.length, 0);
  });

  it("asks for workspace files on PR goals, not a URL", () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const plan = planTask("ship this PR before merge", {}, registry);
    assert.ok(plan.recommended || plan.alternatives.length > 0);
    assert.match(String(plan.next), /workspace|input\.(text|html|code)/i);
    assert.equal(/extract a url/i.test(String(plan.next)), false);
  });
});

describe("suggest hygiene", () => {
  it("returns empty toolSuggestions for joke goals", async () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const result = await solveTask("tell me a joke", {}, {
      apiKey: "ty_test",
      mcpSessionId: "test",
      registry,
      logger: createLogger("error"),
    });
    assert.equal(result.status, "suggest");
    assert.equal(result.toolSuggestions.length, 0);
    assert.equal(result.taskSuggestions.length, 0);
  });
});

describe("verify delta", () => {
  it("detects improved scores", () => {
    const before = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "a",
      workflowId: "a",
      summary: [],
      scores: { overall: { label: "o", value: 30, status: "poor" } },
      findings: [
        { severity: "high", title: "Missing CSP", whyItMatters: "x", howToFix: ["Add CSP"] },
      ],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    const after = {
      ...before,
      scores: { overall: { label: "o", value: 80, status: "good" } },
      findings: [],
    };
    const delta = diffJobReports(before, after);
    assert.equal(delta.status, "improved");
    assert.equal(delta.resolvedFindings.length, 1);
    assert.equal(delta.gate, "pass");
    assert.equal(delta.remainingFixes.length, 0);
  });

  it("verify delta exposes remainingFixes and fail gate", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "a",
      workflowId: "a",
      summary: [],
      scores: { overall: { label: "o", value: 40, status: "poor" } },
      findings: [
        {
          severity: "high",
          title: "Missing CSP",
          whyItMatters: "x",
          howToFix: ["Add CSP"],
          workstream: "headers",
        },
      ],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    const delta = diffJobReports(report, report);
    assert.equal(delta.gate, "fail");
    assert.ok(delta.remainingFixes.length >= 1);
    assert.equal(delta.remainingFixes[0].actions[0], "Add CSP");
    assert.ok(delta.nextActions.length >= 1);
  });

  it("does not treat lower numbers as regression when status stays good", () => {
    const before = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "a",
      workflowId: "a",
      summary: [],
      scores: { lcpMs: { label: "LCP", value: 2200, status: "good" } },
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    const after = {
      ...before,
      scores: { lcpMs: { label: "LCP", value: 1800, status: "good" } },
    };
    const delta = diffJobReports(before, after);
    assert.equal(delta.status, "unchanged");
    assert.equal(delta.scoreDeltas.length, 1);
  });

  it("extractJobReport peels verify.after and get_run.result", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "a",
      workflowId: "a",
      summary: [],
      scores: {},
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    assert.equal(
      extractJobReport({ status: "verified", after: { jobReport: report } })
        ?.jobId,
      "a"
    );
    assert.equal(
      extractJobReport({
        runId: "x",
        result: { execution: { jobReport: report } },
      })?.jobId,
      "a"
    );
  });
});

describe("synthesizer trust (no contradictory summaries)", () => {
  it("never claims success when score is poor and findings exist", async () => {
    const { synthesizeSecurityHeaders } = await import(
      "../../dist/jobs/full-security-audit.js"
    );
    const report = synthesizeSecurityHeaders({
      synthesizerId: "security-headers",
      workflowId: "security-headers-job",
      input: { url: "https://example.com" },
      steps: [{ id: "headers", operationId: "securityHeadersAnalyzer" }],
      stepResults: {
        headers: {
          status: 200,
          data: {
            status: true,
            result: {
              score: 20,
              grade: "F",
              checks: [
                {
                  id: "csp",
                  name: "Content-Security-Policy",
                  present: false,
                  severity: "fail",
                  advice: "Add CSP",
                },
              ],
              summary: { pass: 0, warn: 0, fail: 1 },
            },
          },
        },
      },
    });
    const blob = report.summary.join(" ").toLowerCase();
    assert.ok(report.findings.length > 0);
    assert.ok(report.scores.overall.value < 50);
    assert.equal(/look (acceptable|fine|complete|good)/.test(blob), false);
    assert.match(blob, /20\/100|top fix/);
  });
});
