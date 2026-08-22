import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("tier1 work package", () => {
  it("adds roleHint and Done-when acceptance on remainingFixes", async () => {
    const {
      buildRemainingFixes,
      buildNextActions,
      inferRoleHint,
    } = await import("../../dist/orchestrator/job-report.js");

    const fixes = buildRemainingFixes({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "x",
      workflowId: "ship-gate-job",
      summary: [],
      scores: {
        securityHeaders: { label: "h", value: 10, status: "poor" },
      },
      findings: [
        {
          workstream: "securityHeaders",
          severity: "high",
          title: "Missing Content-Security-Policy",
          whyItMatters: "xss",
          howToFix: ["Add CSP header"],
        },
      ],
      prioritizedActions: [],
      toolsUsed: [],
    });

    assert.equal(fixes.length, 1);
    assert.equal(fixes[0].patchType, "http-header");
    assert.equal(fixes[0].roleHint, "config");
    assert.match(fixes[0].acceptance, /Done when:/i);
    assert.equal(inferRoleHint("config"), "config");

    const next = buildNextActions(fixes);
    assert.equal(next[0].roleHint, "config");
    assert.ok(next[0].acceptance);
  });

  it("MCP instructions spell the host contract", async () => {
    const { resolveMcpInstructions } = await import(
      "../../dist/control-plane/mcp.js"
    );
    const text = resolveMcpInstructions();
    assert.match(text, /rank-1/i);
    assert.match(text, /roleHint/);
    assert.match(text, /does not replace/i);
  });
});
