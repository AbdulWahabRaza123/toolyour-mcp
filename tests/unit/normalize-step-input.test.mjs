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

  it("pulls compressImages srcs into urls for convertToWebp", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const out = normalizeStepInput("convertToWebp", {
      status: 200,
      data: {
        report: {
          evidence: {
            assetOptimizer: {
              compressImages: [{ src: "https://example.com/hero.jpg" }],
            },
          },
        },
      },
    });
    assert.deepEqual(out.urls, ["https://example.com/hero.jpg"]);
  });

  it("does not invent a JWT token when text has none", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const out = normalizeStepInput("jwtDecoder", {
      text: "STRIPE_KEY=sk_live_51ABCDEFdeadbeef\n",
    });
    assert.equal(out.token, undefined);
  });

  it("pulls jwtGenerator result.token for jwtDecoder", async () => {
    const { normalizeStepInput } = await import("../../dist/gateway/request.js");
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig";
    const out = normalizeStepInput("jwtDecoder", {
      status: 200,
      data: { result: { toolId: "jwt-generator", token } },
    });
    assert.equal(out.token, token);
  });
});

describe("resolveDeveloperPasteStepInput", () => {
  it("reuses workflow json after validate-shaped prior step", async () => {
    const { resolveDeveloperPasteStepInput } = await import(
      "../../dist/gateway/request.js"
    );
    const workflow = { json: '{"a":1}' };
    const prior = {
      status: 200,
      data: { result: { toolId: "json-validator", valid: true } },
    };
    const out = resolveDeveloperPasteStepInput(
      "jsonFormatter",
      workflow,
      prior
    );
    assert.equal(out.json, '{"a":1}');
  });

  it("prefers prior result.json over workflow yaml for jsonFormatter", async () => {
    const { resolveDeveloperPasteStepInput } = await import(
      "../../dist/gateway/request.js"
    );
    const workflow = { yaml: "a: 1", text: "a: 1" };
    const prior = {
      status: 200,
      data: { result: { toolId: "yaml-to-json", json: '{\n  "a": 1\n}' } },
    };
    const out = resolveDeveloperPasteStepInput(
      "jsonFormatter",
      workflow,
      prior
    );
    assert.equal(out.json, '{\n  "a": 1\n}');
  });
});
