import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLegacyMcpJson,
  buildManifest,
  buildServerCard,
  MCP_PUBLIC_ENDPOINT,
} from "../../dist/discovery/documents.js";

describe("MCP discovery documents", () => {
  it("server card points at production SSE endpoint", () => {
    const card = buildServerCard();
    assert.equal(card.transport.endpoint, MCP_PUBLIC_ENDPOINT);
    assert.equal(card.transport.type, "sse");
    assert.equal(card.authentication.required, true);
    assert.ok(card.tools.some((t) => t.name === "solve_task"));
    assert.ok(card.tools.some((t) => t.name === "discover_tools"));
  });

  it("manifest lists sse and api_key auth", () => {
    const m = buildManifest();
    assert.equal(m.endpoints.sse, MCP_PUBLIC_ENDPOINT);
    assert.deepEqual(m.authentication.methods, ["api_key"]);
    assert.equal(m.authentication.api_key.header, "X-Api-Key");
  });

  it("legacy mcp.json has endpoint pointer", () => {
    const j = buildLegacyMcpJson();
    assert.equal(j.endpoint, MCP_PUBLIC_ENDPOINT);
    assert.equal(j.authentication.header, "X-Api-Key");
  });
});
