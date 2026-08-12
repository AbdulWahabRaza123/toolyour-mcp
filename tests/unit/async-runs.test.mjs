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

  it("stores and finishes a run", async () => {
    await runStore.start();
    const run = await runStore.create({
      userId: "u1",
      apiKeyId: "k1",
      kind: "solve_task",
    });
    assert.equal(run.status, "accepted");
    await runStore.markRunning(run.id);
    const finished = await runStore.finish(run.id, "completed", {
      status: "completed",
      jobReport: { summary: ["ok"] },
    });
    assert.ok(finished);
    assert.equal(finished.status, "completed");
    const got = await runStore.get(run.id);
    assert.equal(got?.status, "completed");
    assert.deepEqual(got?.result, {
      status: "completed",
      jobReport: { summary: ["ok"] },
    });
  });

  it("ownsRun requires matching user", async () => {
    await runStore.start();
    const run = await runStore.create({
      userId: "u1",
      apiKeyId: "k1",
      kind: "solve_task",
    });
    assert.equal(runStore.ownsRun(run, { userId: "u1", apiKeyId: "k2" }), true);
    assert.equal(runStore.ownsRun(run, { userId: "u2", apiKeyId: "k1" }), false);
  });

  it("serializeRunPoll exposes resultStatus separately from run status", async () => {
    const { serializeRunPoll } = await import("../../dist/runs/serialize.js");
    await runStore.start();
    const run = await runStore.create({
      userId: "u1",
      apiKeyId: "k1",
      kind: "solve_task",
    });
    await runStore.finish(run.id, "completed", { status: "suggest", toolSuggestions: [] });
    const entry = await runStore.get(run.id);
    const poll = serializeRunPoll(entry);
    assert.equal(poll.status, "completed");
    assert.equal(poll.resultStatus, "suggest");
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

describe("optional webhook fault tolerance", () => {
  it("notifyJobFinishedOptional never throws without config", async () => {
    const { notifyJobFinishedOptional } = await import(
      "../../dist/runs/webhook.js"
    );
    const { createLogger } = await import("../../dist/observability/logger.js");
    await runStore.start();
    const run = await runStore.create({
      userId: "u1",
      apiKeyId: "k1",
      kind: "solve_task",
    });
    await runStore.finish(run.id, "completed", { ok: true });
    const finished = await runStore.get(run.id);
    assert.ok(finished);
    const result = await notifyJobFinishedOptional(
      "ty_fake_key_for_test",
      finished,
      createLogger("error")
    );
    assert.equal(result.delivered, false);
    assert.equal(result.attempted, false);
    assert.equal((await runStore.get(run.id))?.status, "completed");
  });
});
