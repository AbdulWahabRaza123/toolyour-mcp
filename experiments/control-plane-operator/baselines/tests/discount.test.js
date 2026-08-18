import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discountAmount } from "../lib/discount.js";

describe("discountAmount", () => {
  it("gives 10% over $100", () => {
    assert.equal(discountAmount(150), 15);
  });
  it("gives no discount at $100", () => {
    assert.equal(discountAmount(100), 0);
  });
  it("gives no discount below $100", () => {
    assert.equal(discountAmount(99), 0);
  });
  it("does not apply a negative-price discount", () => {
    assert.equal(discountAmount(-10), 0);
  });
});
