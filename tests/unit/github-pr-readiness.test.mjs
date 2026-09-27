import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decidePullRequestReadiness, workRecordUpdateFromReadiness } from "../../dist/github/pr-readiness.js";

function evidence(overrides = {}) {
  return {
    source: "github",
    pullRequest: { url: "https://github.com/acme/api/pull/1", owner: "acme", repo: "api", number: 1, title: "Safe change", draft: false, baseSha: "base", headSha: "head" },
    changedFiles: { total: 1, paths: ["src/app.ts"], truncated: false },
    checks: { total: 1, successful: 1, failed: 0, pending: 0, skipped: 0, names: ["test"] },
    reviews: { approved: 1, changesRequested: 0, commented: 0, pending: 0 },
    riskSignals: [],
    collectedAt: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("GitHub PR readiness", () => {
  it("blocks failed checks rather than claiming a pass", () => {
    const result = decidePullRequestReadiness(evidence({ checks: { total: 1, successful: 0, failed: 1, pending: 0, skipped: 0, names: ["test"] } }));
    assert.equal(result.status, "blocked");
    assert.equal(result.gate, "fail");
  });

  it("requires human review for an otherwise clean migration", () => {
    const result = decidePullRequestReadiness(evidence({ riskSignals: [{ code: "database_migration_changed", severity: "high", paths: ["db/migrations/001.sql"] }] }));
    assert.equal(result.status, "human_review_required");
    assert.equal(result.gate, "unknown");
    assert.equal(result.nextActions[0].owner, "human");
  });

  it("writes a token-free WorkRecord payload", () => {
    const readiness = decidePullRequestReadiness(evidence());
    const work = workRecordUpdateFromReadiness({ workId: "work_pr_123456", ownerKey: "owner_hash", objective: "Review PR", readiness });
    assert.equal(work.status, "ready");
    assert.equal(work.latest.gate, "pass");
    assert.equal(JSON.stringify(work).includes("token"), false);
  });

  it("enforces repository-required checks before claiming readiness", () => {
    const result = decidePullRequestReadiness(evidence(), { repository: "acme/api", requiredCheckNames: ["test", "security"], minimumApprovals: 1, reviewPathPrefixes: [] });
    assert.equal(result.status, "human_review_required");
    assert.equal(result.gate, "unknown");
    assert.match(result.reasons[0], /security/);
  });
});
