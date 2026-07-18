import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { getEnv } from "./config";
import { createLogger } from "./observability/logger";
import { RegistryLoader } from "./registry/loader";
import { registerHealthRoutes } from "./health/routes";
import { registerDiscoveryRoutes } from "./discovery/routes";
import { createToolYourMcpServer } from "./tools/mcp-tools";

const env = getEnv();
const logger = createLogger(env.logLevel);
const registry = new RegistryLoader(logger);

registry.start();

const app = express();
// MCP POST /mcp/messages reads the raw stream — do not run express.json() on /mcp*.
app.use((req, res, next) => {
  if (req.path.startsWith("/mcp")) return next();
  express.json({ limit: "2mb" })(req, res, next);
});

registerHealthRoutes(app, registry);
registerDiscoveryRoutes(app);

const transports = new Map<string, SSEServerTransport>();

function extractApiKey(req: express.Request): string | null {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    if (auth.startsWith("ApiKey ")) return auth.slice(7).trim();
    if (auth.startsWith("Bearer ty_")) return auth.slice(7).trim();
  }
  return null;
}

app.get("/mcp", async (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key" });
    return;
  }

  const mcpSessionId = randomUUID();
  const transport = new SSEServerTransport("/mcp/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    transports.delete(transport.sessionId);
  });

  const server = createToolYourMcpServer({
    apiKey,
    mcpSessionId,
    registry,
    logger,
  });

  await server.connect(transport);
  logger.info("mcp session started", { mcpSessionId, transport: "mcp" });
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Unknown MCP session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(env.port, () => {
  logger.info("toolyour-mcp listening", { port: env.port });
});
