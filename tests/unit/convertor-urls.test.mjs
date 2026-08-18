import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateInputAgainstSchema } from "../../dist/orchestrator/schema-validate.js";
import { buildGatewayInvokePayload } from "../../dist/gateway/request.js";

describe("schema-validate convertor oneOf", () => {
  const schema = {
    type: "object",
    additionalProperties: true,
    oneOf: [
      {
        type: "object",
        required: ["urls"],
        properties: {
          urls: { type: "array", items: { type: "string" } },
        },
      },
      {
        type: "object",
        required: ["image"],
        properties: {
          image: { type: "string", format: "binary" },
        },
      },
    ],
  };

  it("accepts urls array without image", () => {
    const result = validateInputAgainstSchema(schema, {
      urls: ["https://example.com/hero.jpg"],
    });
    assert.equal(result.ok, true);
  });

  it("accepts urls as a JSON string", () => {
    const result = validateInputAgainstSchema(schema, {
      urls: '["https://example.com/hero.jpg"]',
    });
    assert.equal(result.ok, true);
  });

  it("accepts image without urls", () => {
    const result = validateInputAgainstSchema(schema, { image: "bytes" });
    assert.equal(result.ok, true);
  });
});

describe("multipart form stringify", () => {
  it("JSON-stringifies url arrays for multipart convertors", () => {
    const payload = buildGatewayInvokePayload(
      {
        operationId: "convertToWebp",
        method: "POST",
        gatewayPath: "/api/v1/convertors/to-webp",
        category: "Convertors",
        name: "Convert image to WebP",
        description: "Convert image to WebP",
        backend: "node",
        multipart: true,
        jsonBody: false,
        validatePaths: ["convertors/to-webp"],
      },
      { urls: ["https://example.com/a.jpg", "https://example.com/b.png"] }
    );
    assert.equal(
      payload.formFields.urls,
      '["https://example.com/a.jpg","https://example.com/b.png"]'
    );
  });
});
