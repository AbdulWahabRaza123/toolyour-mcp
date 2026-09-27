import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPullRequestEvidence, parseGitHubPullRequest } from "../../dist/github/pr-evidence.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("GitHub pull-request evidence", () => {
  it("parses only canonical GitHub pull-request URLs", () => {
    assert.deepEqual(parseGitHubPullRequest("https://github.com/acme/api/pull/42"), { owner: "acme", repo: "api", number: 42 });
    assert.throws(() => parseGitHubPullRequest("https://example.com/acme/api/pull/42"), { code: "invalid_reference" });
  });

  it("binds checks and risk signals to the PR head SHA", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("/pulls/42/files")) return json([{ filename: ".github/workflows/release.yml" }, { filename: "db/migrations/001.sql" }]);
      if (url.includes("/check-runs")) return json({ check_runs: [{ name: "test", status: "completed", conclusion: "success" }, { name: "lint", status: "in_progress", conclusion: null }] });
      if (url.includes("/reviews")) return json([{ state: "CHANGES_REQUESTED" }]);
      return json({ title: "Ship safely", draft: false, changed_files: 2, head: { sha: "head123" }, base: { sha: "base456" } });
    };
    const evidence = await collectPullRequestEvidence({
      pullRequestUrl: "https://github.com/acme/api/pull/42",
      fetchImpl,
      now: new Date("2026-09-27T00:00:00.000Z"),
    });
    assert.equal(evidence.pullRequest.headSha, "head123");
    assert.equal(evidence.checks.successful, 1);
    assert.equal(evidence.checks.pending, 1);
    assert.equal(evidence.reviews.changesRequested, 1);
    assert.deepEqual(evidence.riskSignals.map((signal) => signal.code), ["workflow_changed", "database_migration_changed", "pending_check_runs", "changes_requested"]);
    assert.ok(calls.some((url) => url.includes("/commits/head123/check-runs")));
  });
});
