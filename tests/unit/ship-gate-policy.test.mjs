import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeVerifyGate,
  SHIP_CRITICAL_SCORE_KEYS,
} from "../../dist/orchestrator/job-report.js";
import { synthesizeJobReport } from "../../dist/jobs/synthesize.js";

function baseScores(overrides = {}) {
  return {
    overall: { label: "Ship readiness", value: 85, status: "good" },
    securityHeaders: { label: "Security headers", value: 90, status: "good" },
    tls: { label: "TLS", value: "120d", status: "good" },
    mixedContent: { label: "Mixed content", value: 95, status: "good" },
    httpStatus: { label: "HTTP status", value: 100, status: "good" },
    performance: { label: "Page speed proxy", value: 70, status: "needs_improvement" },
    ...overrides,
  };
}

describe("ship gate policy", () => {
  it("exposes critical score keys", () => {
    assert.ok(SHIP_CRITICAL_SCORE_KEYS.includes("tls"));
    assert.ok(SHIP_CRITICAL_SCORE_KEYS.includes("securityHeaders"));
  });

  it("default policy ignores needs_improvement on headers", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "x",
      workflowId: "x",
      summary: [],
      scores: baseScores({
        securityHeaders: {
          label: "Security headers",
          value: 65,
          status: "needs_improvement",
        },
      }),
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    assert.equal(computeVerifyGate(report), "pass");
  });

  it("ship policy fails needs_improvement on critical scores", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "ship-gate",
      workflowId: "ship-gate-job",
      gatePolicy: "ship",
      summary: [],
      scores: baseScores({
        securityHeaders: {
          label: "Security headers",
          value: 65,
          status: "needs_improvement",
        },
      }),
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    assert.equal(computeVerifyGate(report), "fail");
  });

  it("ship policy allows performance needs_improvement", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "ship-gate",
      workflowId: "ship-gate-job",
      gatePolicy: "ship",
      summary: [],
      scores: baseScores(),
      findings: [],
      prioritizedActions: [],
      toolsUsed: [],
      steps: {},
    };
    assert.equal(computeVerifyGate(report), "pass");
  });

  it("synthesizer stamps gatePolicy=ship", () => {
    const report = synthesizeJobReport({
      synthesizerId: "developer-ship-checklist",
      workflowId: "ship-gate-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "headers", operationId: "securityHeadersAnalyzer" },
        { id: "tls", operationId: "sslTlsCertificateChecker" },
        { id: "mixed", operationId: "mixedContentChecker" },
        { id: "status", operationId: "httpStatusChecker" },
        { id: "speed", operationId: "pageSpeedAnalyzer" },
      ],
      stepResults: {
        headers: {
          status: 200,
          data: {
            status: true,
            result: { score: 90, checks: [], summary: { pass: 1, warn: 0, fail: 0 } },
          },
        },
        tls: {
          status: 200,
          data: {
            status: true,
            result: { severity: "pass", daysRemaining: 100, checks: [] },
          },
        },
        mixed: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: { summary: { totalScore: 95 }, findings: [] },
          },
        },
        status: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: { summary: { totalScore: 100 }, findings: [] },
          },
        },
        speed: {
          status: 200,
          data: {
            schemaVersion: "toolyour.toolResult@1",
            report: { summary: { totalScore: 70 }, findings: [] },
          },
        },
      },
    });
    assert.equal(report?.gatePolicy, "ship");
    assert.equal(computeVerifyGate(report), "pass");
    assert.ok(report.limitations?.some((l) => /smoke checklist|Gate policy \(ship\)/i.test(l)));
  });
});
