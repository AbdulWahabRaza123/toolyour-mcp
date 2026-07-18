import type { Express, Request, Response } from "express";
import {
  buildLegacyMcpJson,
  buildManifest,
  buildServerCard,
  DISCOVERY_RESPONSE_HEADERS,
} from "./documents";

function sendJson(res: Response, body: unknown) {
  res.set(DISCOVERY_RESPONSE_HEADERS);
  res.status(200).send(JSON.stringify(body, null, 2));
}

function handleOptions(_req: Request, res: Response) {
  res.set(DISCOVERY_RESPONSE_HEADERS);
  res.status(204).end();
}

/**
 * Public MCP discovery for api.toolyour.com (proxied via nginx /.well-known/mcp*).
 */
export function registerDiscoveryRoutes(app: Express) {
  app.options("/.well-known/mcp", handleOptions);
  app.options("/.well-known/mcp/server-card.json", handleOptions);
  app.options("/.well-known/mcp.json", handleOptions);

  app.get("/.well-known/mcp", (_req, res) => sendJson(res, buildManifest()));
  app.get("/.well-known/mcp/server-card.json", (_req, res) =>
    sendJson(res, buildServerCard())
  );
  // Early-draft alias still probed by some clients
  app.get("/.well-known/mcp.json", (_req, res) =>
    sendJson(res, buildLegacyMcpJson())
  );
}
