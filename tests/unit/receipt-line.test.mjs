import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReceiptLine } from "../../dist/orchestrator/harness-loop.js";

describe("buildReceiptLine", () => {
  it("summarizes fail + rank-1 + credits", () => {
    const line = buildReceiptLine({
      gate: "fail",
      initiate: true,
      phase: "run",
      nextActions: [
        {
          id: "csp",
          label: "Add Content-Security-Policy",
          patchType: "http-header",
        },
      ],
      remainingFixes: [{ rank: 1, title: "CSP", actions: ["Add CSP"], workstream: "headers", source: "finding", patchType: "http-header", roleHint: "config", acceptance: "ok" }],
      toolsUsed: 5,
      estimatedCredits: 10,
    });
    assert.match(line, /^gate=fail ·/);
    assert.match(line, /rank-1: Add Content-Security-Policy \[http-header\]/);
    assert.match(line, /apply then verify_task/);
    assert.match(line, /~10 credits \(5 tools\)/);
  });

  it("summarizes pass as stop", () => {
    const line = buildReceiptLine({
      gate: "pass",
      initiate: false,
      phase: "verify",
      nextActions: [],
      remainingFixes: [],
      toolsUsed: 3,
      estimatedCredits: 6,
    });
    assert.match(line, /gate=pass · clean · stop/);
    assert.match(line, /~6 credits \(3 tools\)/);
    assert.match(line, /verify$/);
  });

  it("summarizes loop stop", () => {
    const line = buildReceiptLine({
      gate: "fail",
      initiate: false,
      phase: "verify",
      nextActions: [],
      remainingFixes: [],
      toolsUsed: 2,
      estimatedCredits: 4,
      stop: { code: "same_findings", message: "stuck" },
    });
    assert.match(line, /stopped:same_findings/);
    assert.match(line, /escalate/);
  });
});
