import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleStatelessMcpHttpRequest } from "../../dist/transport/stateless-http.js";

const httpServer = createServer((req, res) => {
  const mcpServer = new McpServer({
    name: "toolyour-stateless-http-test",
    version: "1.0.0",
  });
  mcpServer.registerTool(
    "catalog_probe",
    {
      description: "Read-only test catalog entry",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "catalog probe" }],
    })
  );

  void handleStatelessMcpHttpRequest(mcpServer, req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

let endpoint;

function parseSseJson(text) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith("data: "));
  assert.ok(line, `expected an SSE data line, got: ${text}`);
  return JSON.parse(line.slice("data: ".length));
}

async function rpc(message, { sessionId, protocolVersion } = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  return {
    response,
    payload: parseSseJson(await response.text()),
  };
}

describe("stateless Streamable HTTP transport", () => {
  before(async () => {
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    endpoint = `http://127.0.0.1:${address.port}/mcp/http`;
  });

  after(async () => {
    httpServer.close();
    await once(httpServer, "close");
  });

  it("accepts a stale session header on a later read-only catalog request", async () => {
    const protocolVersion = "2025-03-26";
    const init = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "session-recovery-test", version: "1.0.0" },
      },
    });

    assert.equal(init.response.status, 200);
    assert.equal(init.response.headers.get("mcp-session-id"), null);
    assert.equal(init.payload.result.protocolVersion, protocolVersion);

    const listed = await rpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      { sessionId: "stale-session-from-another-instance", protocolVersion }
    );

    assert.equal(listed.response.status, 200);
    assert.ok(
      listed.payload.result.tools.some((tool) => tool.name === "catalog_probe")
    );
  });
});
