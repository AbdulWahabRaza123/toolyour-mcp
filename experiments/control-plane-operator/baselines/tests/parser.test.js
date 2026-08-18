import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePair } from "../lib/parser.js";

describe("parsePair", () => {
  it("parses key:value", () => {
    assert.deepEqual(parsePair("a:b"), { key: "a", value: "b" });
  });
  it("parses values containing colons", () => {
    assert.deepEqual(parsePair("url:http://x"), { key: "url", value: "http://x" });
  });
  it("rejects empty input", () => {
    assert.equal(parsePair(""), null);
  });
});
