import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeVerifyGate } from "../../dist/orchestrator/job-report.js";
import { shapeAgentResult } from "../../dist/orchestrator/harness-loop.js";
import { localSeoToJobReport, analyzeLocalHtml } from "../../dist/orchestrator/local-seo.js";
import { synthesizeJobReport } from "../../dist/jobs/synthesize.js";
import { planTask } from "../../dist/orchestrator/plan-task.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";

describe("gate honesty P0", () => {
  it("fails when a primary workstream score is unknown", () => {
    const gate = computeVerifyGate({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "full-seo-audit",
      workflowId: "full-seo-audit",
      summary: [],
      scores: {
        overall: { label: "o", value: 100, status: "unknown" },
        technicalSeo: { label: "seo", value: "—", status: "unknown" },
        performance: { label: "p", value: 100, status: "good" },
        LCP: { label: "lcp", value: 100, status: "good" },
      },
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    });
    assert.equal(gate, "fail");
  });

  it("secrets policy fails with open secret findings even if medium", () => {
    const gate = computeVerifyGate({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "secrets-hygiene-job",
      workflowId: "secrets-hygiene-job",
      gatePolicy: "secrets",
      summary: [],
      scores: {
        overall: { label: "s", value: 70, status: "needs_improvement" },
      },
      findings: [
        {
          workstream: "secrets",
          severity: "medium",
          title: "jwt",
          whyItMatters: "x",
          howToFix: ["Rotate"],
        },
      ],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    });
    assert.equal(gate, "fail");
  });

  it("secrets synthesizer stamps gatePolicy=secrets", () => {
    const report = synthesizeJobReport({
      synthesizerId: "secrets-hygiene",
      workflowId: "secrets-hygiene-job",
      input: { text: "API_KEY=sk_live_test" },
      steps: [
        { id: "leak", operationId: "secretLeakScanner" },
        { id: "jwt", operationId: "jwtDecoder" },
      ],
      stepResults: {
        leak: {
          status: 200,
          data: {
            status: true,
            result: {
              matches: [
                {
                  type: "generic-secret-assignment",
                  severity: "medium",
                  preview: "API_…",
                },
              ],
              matchCount: 1,
            },
          },
        },
        jwt: { status: 200, data: { status: true, result: {} } },
      },
    });
    assert.equal(report.gatePolicy, "secrets");
    assert.equal(computeVerifyGate(report), "fail");
    assert.ok(report.findings.some((f) => f.severity === "high"));
  });

  it("SEO synthesizer marks incomplete when SEO score missing", () => {
    const report = synthesizeJobReport({
      synthesizerId: "full-seo-audit",
      workflowId: "full-seo-audit",
      input: { url: "https://example.com" },
      steps: [
        { id: "seo", operationId: "seoAnalyze" },
        { id: "speed", operationId: "pageSpeedAnalyzer" },
      ],
      stepResults: {
        speed: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: {
              summary: { totalScore: 100 },
              metrics: { proxies: { lcpScore: 100, clsScore: 100 } },
              findings: [],
            },
          },
        },
      },
    });
    assert.equal(report.incomplete, true);
    assert.equal(computeVerifyGate(report), "fail");
    assert.equal(report.summary.some((s) => /INCOMPLETE|unavailable/i.test(s)), true);
  });
});

describe("local HTML SEO closable", () => {
  it("produces jobReport with remediable fixes", () => {
    const local = analyzeLocalHtml(
      "<html><head><title>x</title></head><body><h1>Hi</h1></body></html>"
    );
    const report = localSeoToJobReport(local);
    assert.ok(report.findings.length > 0);
    assert.notEqual(report.scores.overall.status, "good");
    const shaped = shapeAgentResult(
      {
        status: "completed",
        jobReport: report,
        execution: { mode: "content-bridge", jobReport: report, local: [local] },
      },
      "compact"
    );
    assert.equal(shaped.loop.gate, "fail");
    assert.equal(shaped.loop.initiate, true);
    assert.ok(shaped.loop.remainingFixes.length >= 1);
  });
});

describe("plan_task honesty", () => {
  it("blocks localhost with initiate false", () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const plan = planTask(
      "ship gate for http://localhost:3000",
      { url: "http://localhost:3000" },
      registry
    );
    assert.equal(plan.loop.initiate, false);
    assert.match(String(plan.next), /localhost|html|preview/i);
  });

  it("clears toolHints for out-of-catalog jokes", () => {
    const registry = new RegistryLoader(createLogger("error"));
    registry.reload(true);
    const plan = planTask("tell me a joke", {}, registry);
    assert.equal(plan.confidence, "none");
    assert.equal(plan.toolHints.length, 0);
    assert.equal(plan.alternatives.length, 0);
  });
});
