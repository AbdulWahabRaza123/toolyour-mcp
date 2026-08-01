import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { constants, getEnv } from "./config";
import { createLogger } from "./observability/logger";
import { RegistryLoader } from "./registry/loader";
import { defsCache } from "./registry/defs-cache";
import { payloadStore } from "./payloads/store";
import { runStore } from "./runs/store";
import { registerHealthRoutes } from "./health/routes";
import { registerDiscoveryRoutes } from "./discovery/routes";
import { createToolYourMcpServer } from "./tools/mcp-tools";

const env = getEnv();
const logger = createLogger(env.logLevel);
const registry = new RegistryLoader(logger);

registry.start();
defsCache.start(logger);
payloadStore.start();
void runStore.start(logger);

const app = express();
// SSE POST /mcp/messages reads the raw stream — skip JSON there.
// Streamable HTTP needs a parsed body on /mcp/http.
app.use((req, res, next) => {
  if (req.path === "/mcp/messages") return next();
  if (req.path.startsWith("/mcp") && req.path !== "/mcp/http") return next();
  express.json({ limit: "4mb" })(req, res, next);
});

registerHealthRoutes(app, registry);
registerDiscoveryRoutes(app);

interface SseSessionEntry {
  kind: "sse";
  transport: SSEServerTransport;
  createdAt: number;
  lastActiveAt: number;
  mcpSessionId: string;
}

interface HttpSessionEntry {
  kind: "http";
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastActiveAt: number;
  mcpSessionId: string;
}

const sseTransports = new Map<string, SseSessionEntry>();
const httpTransports = new Map<string, HttpSessionEntry>();

function touchSse(sessionId: string) {
  const entry = sseTransports.get(sessionId);
  if (entry) entry.lastActiveAt = Date.now();
}

function touchHttp(sessionId: string) {
  const entry = httpTransports.get(sessionId);
  if (entry) entry.lastActiveAt = Date.now();
}

function sweepStaleSessions() {
  const now = Date.now();
  for (const [id, entry] of sseTransports.entries()) {
    if (now - entry.lastActiveAt > constants.mcpSessionTtlMs) {
      sseTransports.delete(id);
      logger.info("mcp sse session swept", {
        mcpSessionId: entry.mcpSessionId,
        idleMs: now - entry.lastActiveAt,
        transport: "mcp-sse",
      });
      try {
        (entry.transport as { close?: () => void }).close?.();
      } catch {
        /* ignore */
      }
    }
  }
  for (const [id, entry] of httpTransports.entries()) {
    if (now - entry.lastActiveAt > constants.mcpSessionTtlMs) {
      httpTransports.delete(id);
      logger.info("mcp http session swept", {
        mcpSessionId: entry.mcpSessionId,
        idleMs: now - entry.lastActiveAt,
        transport: "mcp-http",
      });
      try {
        void entry.transport.close?.();
      } catch {
        /* ignore */
      }
    }
  }
}

setInterval(sweepStaleSessions, constants.mcpSessionSweepMs).unref?.();

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

/** Legacy SSE transport (Cursor / existing clients). */
app.get("/mcp", async (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key" });
    return;
  }

  const mcpSessionId = randomUUID();
  const transport = new SSEServerTransport("/mcp/messages", res);
  const now = Date.now();
  sseTransports.set(transport.sessionId, {
    kind: "sse",
    transport,
    createdAt: now,
    lastActiveAt: now,
    mcpSessionId,
  });

  res.on("close", () => {
    const entry = sseTransports.get(transport.sessionId);
    sseTransports.delete(transport.sessionId);
    logger.info("mcp sse session ended", {
      mcpSessionId,
      durationMs: entry ? Date.now() - entry.createdAt : undefined,
      transport: "mcp-sse",
    });
  });

  const server = createToolYourMcpServer({
    apiKey,
    mcpSessionId,
    registry,
    logger,
  });

  await server.connect(transport);
  logger.info("mcp sse session started", { mcpSessionId, transport: "mcp-sse" });
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const entry = sseTransports.get(sessionId);
  if (!entry) {
    res.status(404).json({ error: "Unknown MCP session" });
    return;
  }
  touchSse(sessionId);
  await entry.transport.handlePostMessage(req, res);
});

/**
 * Streamable HTTP transport (free, SDK-native). Use when clients support MCP Streamable HTTP.
 * Endpoint: https://api.toolyour.com/mcp/http
 */
async function handleStreamableHttp(
  req: express.Request,
  res: express.Response
) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key" });
    return;
  }

  const sessionHeader = req.headers["mcp-session-id"];
  const existingId =
    typeof sessionHeader === "string" && sessionHeader.trim()
      ? sessionHeader.trim()
      : undefined;

  if (existingId && httpTransports.has(existingId)) {
    const entry = httpTransports.get(existingId)!;
    touchHttp(existingId);
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === "POST" && !existingId) {
    const mcpSessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) httpTransports.delete(sid);
    };

    const server = createToolYourMcpServer({
      apiKey,
      mcpSessionId,
      registry,
      logger,
    });
    await server.connect(transport);

    const now = Date.now();
    // sessionId is assigned during handleRequest init
    await transport.handleRequest(req, res, req.body);

    const sid = transport.sessionId;
    if (sid) {
      httpTransports.set(sid, {
        kind: "http",
        transport,
        createdAt: now,
        lastActiveAt: now,
        mcpSessionId,
      });
      logger.info("mcp http session started", {
        mcpSessionId,
        transport: "mcp-http",
        sessionId: sid,
      });
    }
    return;
  }

  res.status(400).json({
    error:
      "Unknown or missing MCP session. Initialize with POST /mcp/http (Streamable HTTP).",
  });
}

app.post("/mcp/http", (req, res) => {
  void handleStreamableHttp(req, res);
});
app.get("/mcp/http", (req, res) => {
  void handleStreamableHttp(req, res);
});
app.delete("/mcp/http", (req, res) => {
  void handleStreamableHttp(req, res);
});

/** Retrieve full truncated payload (same API key). Free in-process store. */
app.get("/mcp/payloads/:id", (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key" });
    return;
  }
  const entry = payloadStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({
      error: "Payload not found or expired",
      hint: "dataRef entries are short-lived in-process; re-run the tool if expired.",
    });
    return;
  }
  res.json({
    id: entry.id,
    operationId: entry.operationId,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    originalBytes: entry.bytes,
    data: entry.data,
  });
});

/** Poll async MCP run (same API key). Memory + optional Redis TTL (~60m). */
app.get("/mcp/runs/:id", async (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Api-Key" });
    return;
  }
  const entry = await runStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({
      error: "Run not found or expired",
      hint: "Async runs TTL ~60m. With REDIS_URL, get_run works across MCP replicas; without Redis, poll the same instance that accepted the job.",
    });
    return;
  }
  res.json({
    runId: entry.id,
    kind: entry.kind,
    status: entry.status,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    result: entry.result ?? null,
    error: entry.error ?? null,
  });
});

app.listen(env.port, () => {
  logger.info("toolyour-mcp listening", {
    port: env.port,
    transports: ["sse:/mcp", "http:/mcp/http"],
  });
});
