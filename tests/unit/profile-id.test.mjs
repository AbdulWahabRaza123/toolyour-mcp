import { describe, it } from "node:test";
import assert from "node:assert/strict";
import profileIdModule from "../../dist/auth/profile-id.js";

const { createToolYourProfileId } = profileIdModule;

describe("ToolYour MCP profile IDs", () => {
  it("is stable across requests and opaque to the source user ID", () => {
    const first = createToolYourProfileId("user_1234567890abcdef");
    const second = createToolYourProfileId("user_1234567890abcdef");

    assert.equal(first, second);
    assert.match(first, /^typrof_[a-f0-9]{32}$/);
    assert.equal(first.includes("user_1234567890abcdef"), false);
  });

  it("creates distinct profile IDs for distinct ToolYour users", () => {
    assert.notEqual(
      createToolYourProfileId("user_one"),
      createToolYourProfileId("user_two")
    );
  });

  it("fails closed when the persistent user ID is missing", () => {
    assert.throws(() => createToolYourProfileId("  "), /user ID is required/);
  });
});
