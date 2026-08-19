import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearSessionCache } from "../../dist/auth/session.js";
import {
  ensureControlPlaneAccess,
  requiresControlPlaneOptIn,
} from "../../dist/control-plane/opt-in.js";

const logger = { warn() {}, info() {}, error() {}, debug() {} };

describe("control-plane key opt-in", { concurrency: 1 }, () => {
  const prevExperiment = process.env.CONTROL_PLANE_EXPERIMENT;
  const prevBackend = process.env.CONTROL_PLANE_JOBS_BACKEND;
  const prevFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = prevFetch;
    if (prevExperiment === undefined) delete process.env.CONTROL_PLANE_EXPERIMENT;
    else process.env.CONTROL_PLANE_EXPERIMENT = prevExperiment;
    if (prevBackend === undefined) delete process.env.CONTROL_PLANE_JOBS_BACKEND;
    else process.env.CONTROL_PLANE_JOBS_BACKEND = prevBackend;
    clearSessionCache();
  });

  beforeEach(() => {
    clearSessionCache();
    delete process.env.CONTROL_PLANE_EXPERIMENT;
    delete process.env.CONTROL_PLANE_JOBS_BACKEND;
    globalThis.fetch = prevFetch;
  });

  it("does not require opt-in on the file backend", () => {
    assert.equal(requiresControlPlaneOptIn(), false);
  });

  it("requires opt-in when jobs backend is saas", () => {
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    assert.equal(requiresControlPlaneOptIn(), true);
  });

  it("experiment flag skips opt-in even if saas backend is set", () => {
    process.env.CONTROL_PLANE_EXPERIMENT = "true";
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    assert.equal(requiresControlPlaneOptIn(), false);
  });

  it("file backend allows access without calling validate-key", async () => {
    globalThis.fetch = async () => {
      throw new Error("validate-key should not run on file backend");
    };
    const access = await ensureControlPlaneAccess("ty_experiment", logger);
    assert.equal(access.ok, true);
  });

  it("saas backend allows keys with controlPlane true", async () => {
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          allowed: true,
          sessionToken: "tok",
          userId: "u1",
          apiKeyId: "k1",
          controlPlane: true,
        }),
        { status: 200 }
      );
    const access = await ensureControlPlaneAccess("ty_live", logger);
    assert.equal(access.ok, true);
  });

  it("saas backend denies keys without controlPlane", async () => {
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          allowed: true,
          sessionToken: "tok",
          userId: "u1",
          apiKeyId: "k1",
          controlPlane: false,
        }),
        { status: 200 }
      );
    const access = await ensureControlPlaneAccess("ty_live", logger);
    assert.equal(access.ok, false);
    if (!access.ok) {
      assert.equal(access.code, "unauthorized");
      assert.match(access.message, /not enabled for control-plane jobs/);
    }
  });

  it("saas backend denies invalid keys", async () => {
    process.env.CONTROL_PLANE_JOBS_BACKEND = "saas";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ allowed: false, reason: "Invalid or revoked API key" }),
        { status: 200 }
      );
    const access = await ensureControlPlaneAccess("ty_bad", logger);
    assert.equal(access.ok, false);
    if (!access.ok) {
      assert.equal(access.code, "unauthorized");
      assert.equal(access.message, "Invalid or revoked API key");
    }
  });
});
