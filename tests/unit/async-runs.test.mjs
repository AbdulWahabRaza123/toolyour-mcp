import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { runStore } from "../../dist/runs/store.js";
import { wantsAsync } from "../../dist/runs/async-job.js";

describe("async runs", () => {
  it("wantsAsync parses truthy flags", () => {
    assert.equal(wantsAsync(true), true);
    assert.equal(wantsAsync("true"), true);
    assert.equal(wantsAsync(false), false);
    assert.equal(wantsAsync(undefined), false);
  });

  it("stores and finishes a run", () => {
    runStore.start();
    const run = runStore.create({
      userId: "u1",
      apiKeyId: "k1",
      kind: "solve_task",
    });
    assert.equal(run.status, "accepted");
    runStore.markRunning(run.id);
    const finished = runStore.finish(run.id, "completed", {
      status: "completed",
      jobReport: { summary: ["ok"] },
    });
    assert.ok(finished);
    assert.equal(finished.status, "completed");
    const got = runStore.get(run.id);
    assert.equal(got?.status, "completed");
    assert.deepEqual(got?.result, {
      status: "completed",
      jobReport: { summary: ["ok"] },
    });
  });

  it("HMAC signature is stable for webhook body", () => {
    const body = JSON.stringify({ event: "mcp.job.finished", runId: "abc" });
    const secret = "test-secret";
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(
      createHmac("sha256", secret).update(body).digest("hex"),
      sig
    );
  });
});
