import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  jobStore,
  saasJobsCollectionUrl,
  useSaasJobsBackend,
} from "../../dist/control-plane/store.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function sampleJob(id = JOB_ID) {
  const now = Date.now();
  return {
    id,
    ownerKey: "owner",
    goal: "goal",
    spec: {
      acceptance: [{ id: "ac1", statement: "s", requiredCheckIds: ["c1"] }],
      checks: [{ id: "c1", kind: "test", command: "node --test", blocking: true }],
      requiredCheckIds: ["c1"],
      maxIterations: 8,
      repeatFailN: 3,
    },
    specHash: "hash",
    state: "open",
    iteration: 0,
    maxIterations: 8,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
    lastDecision: null,
    iterations: [],
  };
}

describe("control-plane job store", { concurrency: 1 }, () => {
  const prevBackend = process.env.CONTROL_PLANE_JOBS_BACKEND;
  const prevJobsUrl = process.env.CONTROL_PLANE_JOBS_URL;
  const prevValidate = process.env.SAAS_VALIDATE_URL;
  const prevData = process.env.CONTROL_PLANE_DATA_DIR;
  const prevSecret = process.env.SAAS_INTERNAL_SECRET;
  const prevFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = prevFetch;
    for (const [key, val] of [
      ["CONTROL_PLANE_JOBS_BACKEND", prevBackend],
      ["CONTROL_PLANE_JOBS_URL", prevJobsUrl],
      ["SAAS_VALIDATE_URL", prevValidate],
      ["CONTROL_PLANE_DATA_DIR", prevData],
      ["SAAS_INTERNAL_SECRET", prevSecret],
    ]) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("defaults to the file backend", () => {
    delete process.env.CONTROL_PLANE_JOBS_BACKEND;
    assert.equal(useSaasJobsBackend(), false);
  });

  it("derives SaaS jobs URL from SAAS_VALIDATE_URL", () => {
    delete process.env.CONTROL_PLANE_JOBS_URL;
    process.env.SAAS_VALIDATE_URL = "http://127.0.0.1:3002/internal/validate-key";
    assert.equal(
      saasJobsCollectionUrl(),
      "http://127.0.0.1:3002/internal/control-plane/jobs"
    );
  });

  it("file backend create/get/update/owns", async () => {
    delete process.env.CONTROL_PLANE_JOBS_BACKEND;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ty-cp-jobs-"));
    process.env.CONTROL_PLANE_DATA_DIR = dir;
    const job = sampleJob();
    await jobStore.create(job);
    const loaded = await jobStore.get(job.id);
    assert.equal(loaded?.id, job.id);
    assert.equal(jobStore.owns(loaded, "owner"), true);
    assert.equal(jobStore.owns(loaded, "other"), false);
    loaded.state = "cancelled";
    await jobStore.update(loaded);
    const again = await jobStore.get(job.id);
    assert.equal(again?.state, "cancelled");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("saas backend PUTs then GETs via internal secret", async () => {
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    process.env.SAAS_INTERNAL_SECRET = "test-secret";
    process.env.CONTROL_PLANE_JOBS_URL = "http://saas.test/internal/control-plane/jobs";
    const job = sampleJob();
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      const method = init?.method || "GET";
      if (method === "PUT") {
        return new Response(JSON.stringify({ job }), { status: 201 });
      }
      return new Response(JSON.stringify({ job }), { status: 200 });
    };
    await jobStore.create(job);
    const loaded = await jobStore.get(job.id);
    assert.equal(loaded?.id, job.id);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/11111111-1111-4111-8111-111111111111$/);
    assert.equal(calls[0].method, "PUT");
    const parsed = JSON.parse(calls[0].body);
    assert.equal(parsed.job.id, job.id);
  });
});
