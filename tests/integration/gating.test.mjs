import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_ERROR_CODES } from "../../dist/contracts/errors.js";

describe("hasApi gating messages", () => {
  it("defines tool_not_api_backed", () => {
    assert.equal(MCP_ERROR_CODES.TOOL_NOT_API_BACKED, "tool_not_api_backed");
  });
});
