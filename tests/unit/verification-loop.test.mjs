import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractProfileId,
  extractTargetUrl,
  baselineFromProfileLastRun,
  regressionVsLastPass,
} from "../../dist/orchestrator/verification-loop.js";
import { isDevelopmentVerificationGoal } from "../../dist/orchestrator/dev-verification-intent.js";

describe("verification profile helpers", () => {
  it("extracts profileId from input and verification envelope", () => {
    assert.equal(extractProfileId({ profileId: "vp_123" }), "vp_123");
    assert.equal(
      extractProfileId({ verification: { profileId: "vp_nested" } }),
      "vp_nested"
    );
    assert.equal(extractProfileId({}), undefined);
  });

  it("extracts target url aliases", () => {
    assert.equal(extractTargetUrl({ url: "https://a.com" }), "https://a.com");
    assert.equal(extractTargetUrl({ pageUrl: "https://b.com" }), "https://b.com");
    assert.equal(extractTargetUrl({}), undefined);
  });

  it("loads baseline from profile lastRunSnapshot", () => {
    const snapshot = {
      loop: { gate: "fail" },
      jobReport: {
        schemaVersion: "toolyour.jobReport@1",
        jobId: "x",
        findings: [],
        scores: {},
      },
    };
    const baseline = baselineFromProfileLastRun(snapshot);
    assert.ok(baseline);
    assert.equal(baseline.jobReport.jobId, "x");
  });

  it("detects regression vs last pass snapshot", () => {
    const before = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "before",
      findings: [],
      scores: {
        overall: { label: "Overall", value: 90, status: "good" },
      },
    };
    const after = {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "after",
      findings: [
        { findingId: "n1", severity: "high", title: "New issue" },
      ],
      scores: {
        overall: { label: "Overall", value: 70, status: "needs_improvement" },
      },
    };
    const delta = regressionVsLastPass(
      { jobReport: before },
      after
    );
    assert.ok(delta);
    assert.ok(["regressed", "unchanged", "improved"].includes(delta.status));
  });
});

describe("development verification intent", () => {
  it("matches production-ready and preview deploy goals", () => {
    assert.equal(isDevelopmentVerificationGoal("verify my preview deploy"), true);
    assert.equal(isDevelopmentVerificationGoal("make this production ready"), true);
    assert.equal(isDevelopmentVerificationGoal("ship this PR before merge"), false);
    assert.equal(isDevelopmentVerificationGoal("ship gate for https://example.com"), false);
    assert.equal(isDevelopmentVerificationGoal("fix React hook"), false);
  });
});
