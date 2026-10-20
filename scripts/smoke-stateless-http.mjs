#!/usr/bin/env node
/**
 * Read-only Streamable HTTP session-recovery check.
 * Usage: MCP_API_KEY=ty_... [MCP_URL=https://api.toolyour.com/mcp/http] npm run smoke:stateless-http
 * Never prints the API key or invokes a billable catalog operation.
 */

const mcpUrl = process.env.MCP_URL || "https://api.toolyour.com/mcp/http";
const apiKey = process.env.MCP_API_KEY;

if (!apiKey) {
  console.error("Set MCP_API_KEY; the value will not be printed.");
  process.exit(2);
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter(Boolean);
    for (const line of dataLines.reverse()) {
      try {
        return JSON.parse(line);
      } catch {
        // Keep looking in case the stream includes non-JSON events.
      }
    }
    throw new Error("MCP response did not contain a JSON or SSE JSON payload");
  }
}

async function post(message, { sessionId, protocolVersion } = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "x-api-key": apiKey,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;

  const response = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  const text = await response.text();
  let payload;
  try {
    payload = parsePayload(text);
  } catch (error) {
    throw new Error(`HTTP ${response.status}: ${error.message}`);
  }
  return { response, payload };
}

try {
  const protocolVersion = "2025-03-26";
  const initialized = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "toolyour-stateless-http-smoke", version: "1.0.0" },
    },
  });

  if (!initialized.response.ok || initialized.payload?.error) {
    throw new Error(
      `initialize failed: HTTP ${initialized.response.status} ${JSON.stringify(initialized.payload?.error || initialized.payload).slice(0, 300)}`
    );
  }
  if (initialized.response.headers.get("mcp-session-id")) {
    throw new Error("initialize returned a session ID; expected stateless HTTP");
  }

  const listed = await post(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    {
      sessionId: "stale-session-from-another-instance",
      protocolVersion,
    }
  );

  const tools = listed.payload?.result?.tools;
  if (
    !listed.response.ok ||
    listed.payload?.error ||
    !Array.isArray(tools) ||
    tools.length === 0
  ) {
    throw new Error(
      `tools/list with stale session failed: HTTP ${listed.response.status} ${JSON.stringify(listed.payload?.error || listed.payload).slice(0, 300)}`
    );
  }

  console.log(
    `PASS stateless Streamable HTTP: initialize returned no session ID; tools/list accepted a stale session header (${tools.length} tools).`
  );
} catch (error) {
  console.error(`FAIL stateless Streamable HTTP: ${error.message}`);
  process.exitCode = 1;
}
