import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidencePack,
  buildRegressionAlert,
} from "../../dist/orchestrator/evidence.js";

describe("verification evidence", () => {
  it("builds evidence from findings and rank-1 fix", () => {
    const report = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "ship-gate",
      url: "https://example.com",
      findings: [
        {
          findingId: "f1",
          severity: "high",
          title: "Missing CSP",
          workstream: "securityHeaders",
          howToFix: ["Add Content-Security-Policy header"],
        },
      ],
      scores: {
        securityHeaders: {
          label: "Security headers",
          value: 40,
          status: "poor",
        },
      },
    };

    const evidence = buildEvidencePack({
      report,
      remainingFixes: [
        {
          findingId: "f1",
          title: "Missing CSP",
          severity: "high",
          acceptance: "Add CSP",
          workstream: "securityHeaders",
        },
      ],
      url: "https://example.com",
      runId: "run_abc",
    });

    assert.ok(evidence.length >= 1);
    assert.equal(evidence[0].status, "failed");
    assert.ok(evidence[0].acceptance);
    assert.equal(evidence[0].runId, "run_abc");
  });

  it("emits regression alert when delta regressed", () => {
    const alert = buildRegressionAlert({
      delta: {
        status: "regressed",
        summary: ["TLS score dropped"],
      },
      profileLastPassAt: "2026-08-01T00:00:00.000Z",
      profileLastPassGate: "pass",
    });
    assert.match(alert, /regressed|TLS/i);
    assert.match(alert, /2026-08-01/);
  });
});
