import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateRunnerNonce,
  generateSecret,
  hashRunnerNonce,
  leakSecretKeys,
  nonceAccepted,
  tokenAccepted,
  tokensEqual,
  writeRunnerNonce,
  readRunnerNonce,
} from "../../dist/control-plane/secrets.js";

describe("control-plane secrets", () => {
  it("rejects empty and short tokens", () => {
    assert.equal(tokenAccepted("", "abcdefghijklmnop"), false);
    assert.equal(tokenAccepted("abcdefghijklmnop", ""), false);
    assert.equal(tokenAccepted("short", "short"), false);
    assert.equal(tokenAccepted("abcdefghijklmnop", "abcdefghijklmnop"), true);
  });

  it("tokensEqual is length-safe", () => {
    assert.equal(tokensEqual("aa", "bb"), false);
    assert.equal(tokensEqual("same-token-value", "same-token-value"), true);
  });

  it("nonceAccepted requires matching hash", () => {
    const nonce = generateRunnerNonce();
    const hash = hashRunnerNonce(nonce);
    assert.equal(nonceAccepted(nonce, hash), true);
    assert.equal(nonceAccepted(generateRunnerNonce(), hash), false);
    assert.equal(nonceAccepted("", hash), false);
    assert.equal(nonceAccepted(nonce, undefined), false);
  });

  it("round-trips nonce files", () => {
    const prev = process.env.CONTROL_PLANE_SECRETS_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ty-cp-"));
    process.env.CONTROL_PLANE_SECRETS_DIR = dir;
    try {
      const jobId = "00000000-0000-4000-8000-000000000001";
      const nonce = generateSecret();
      writeRunnerNonce(jobId, nonce);
      assert.equal(readRunnerNonce(jobId), nonce);
    } finally {
      if (prev === undefined) delete process.env.CONTROL_PLANE_SECRETS_DIR;
      else process.env.CONTROL_PLANE_SECRETS_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects leaked secret keys in payloads", () => {
    assert.deepEqual(leakSecretKeys({ jobId: "x", state: "open" }), []);
    assert.deepEqual(leakSecretKeys({ runnerNonce: "secret" }), ["runnerNonce"]);
    assert.ok(leakSecretKeys({ runnerNonceHash: "abc", startToken: "t" }).includes("startToken"));
  });
});
