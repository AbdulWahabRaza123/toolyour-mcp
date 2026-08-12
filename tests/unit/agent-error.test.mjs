import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCaughtError,
  normalizeHttpError,
} from "../../dist/contracts/agent-error.js";
import { MCP_ERROR_CODES } from "../../dist/contracts/errors.js";

describe("agent error shapes", () => {
  it("maps 429 to quota_exceeded with hint", () => {
    const err = normalizeHttpError(429, { reason: "Monthly quota exceeded" }, "");
    assert.equal(err.code, MCP_ERROR_CODES.QUOTA_EXCEEDED);
    assert.equal(err.retryable, true);
    assert.ok(err.hint);
    assert.ok(Array.isArray(err.nextActions) && err.nextActions.length > 0);
  });

  it("maps 403 allowlist to tool_not_allowed", () => {
    const err = normalizeHttpError(
      403,
      { reason: "Tool not allowed for this API key" },
      ""
    );
    assert.equal(err.code, MCP_ERROR_CODES.TOOL_NOT_ALLOWED);
    assert.equal(err.retryable, false);
  });

  it("maps 401 to unauthorized", () => {
    const err = normalizeHttpError(401, { message: "Invalid or revoked API key" }, "");
    assert.equal(err.code, MCP_ERROR_CODES.UNAUTHORIZED);
  });

  it("formats circuit_open with retryable", () => {
    const err = formatCaughtError(
      Object.assign(new Error("Backend circuit open"), {
        code: "circuit_open",
        retryable: true,
        retryAfterMs: 8000,
      })
    );
    assert.equal(err.code, MCP_ERROR_CODES.CIRCUIT_OPEN);
    assert.equal(err.retryable, true);
    assert.equal(err.retryAfterMs, 8000);
  });
});
