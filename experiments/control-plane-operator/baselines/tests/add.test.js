import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { add } from "../lib/add.js";

describe("add", () => {
  it("adds two numbers", () => {
    assert.equal(add(2, 3), 5);
  });
  it("adds zeros", () => {
    assert.equal(add(0, 0), 0);
  });
});
