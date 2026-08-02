import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("normalizeStepInput", () => {
  it("extracts JWT from pasted text for jwtDecoder", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig";
    const out = normalizeStepInput("jwtDecoder", {
      text: `Authorization: Bearer ${token}\n`,
    });
    assert.equal(out.token, token);
  });

  it("extracts alg=none JWT with empty signature segment", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.";
    const out = normalizeStepInput("jwtDecoder", {
      text: `Authorization: Bearer ${token}`,
    });
    assert.equal(out.token, token);
  });

  it("maps token to text for secretLeakScanner", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const out = normalizeStepInput("secretLeakScanner", {
      token: "eyJhbGciOiJub25lIn0.e30.",
    });
    assert.equal(out.text, "eyJhbGciOiJub25lIn0.e30.");
  });
});
