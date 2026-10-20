import type { IncomingMessage, ServerResponse } from "http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Handle one Streamable HTTP request without process-local session affinity.
 * The transport is intentionally created per request; it ignores stale or
 * missing Mcp-Session-Id headers and emits no session ID of its own.
 */
export async function handleStatelessMcpHttpRequest(
  server: McpServer,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
