import type { Express, Request, Response } from "express";
import { RegistryLoader } from "../registry/loader";
import { defsCache } from "../registry/defs-cache";
import { checkGatewayHealth, gatewaySemaphore } from "../gateway/client";
import { circuitBreaker } from "../gateway/circuit-breaker";
import { getEnv } from "../config";
import { getCounters } from "../observability/counters";
import { payloadStore } from "../payloads/store";

export function registerHealthRoutes(
  app: Express,
  registry: RegistryLoader
) {
  app.get("/health/mcp", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      service: "toolyour-mcp",
      registryLoaded: registry.isReady(),
      registryStaleMs: registry.staleAgeMs(),
      defsLoaded: defsCache.isReady(),
      defsStaleMs: defsCache.staleAgeMs(),
      circuitBreaker: circuitBreaker.snapshot(),
      gatewayConcurrency: gatewaySemaphore.stats(),
      counters: getCounters(),
      payloadStore: payloadStore.stats(),
      transports: ["sse:GET /mcp", "http:POST /mcp", "http:/mcp/http"],
    });
  });

  /** Prometheus text exposition (open metrics format; no vendor lock-in). */
  app.get("/health/mcp/metrics", (_req: Request, res: Response) => {
    const c = getCounters();
    const lines = [
      "# HELP toolyour_mcp_invokes Gateway tool invokes",
      "# TYPE toolyour_mcp_invokes counter",
      `toolyour_mcp_invokes ${c.invokes}`,
      "# HELP toolyour_mcp_workflow_completed Completed workflows",
      "# TYPE toolyour_mcp_workflow_completed counter",
      `toolyour_mcp_workflow_completed ${c.workflowCompleted}`,
      "# HELP toolyour_mcp_workflow_partial Partial workflows",
      "# TYPE toolyour_mcp_workflow_partial counter",
      `toolyour_mcp_workflow_partial ${c.workflowPartial}`,
      "# HELP toolyour_mcp_circuit_opens Circuit breaker opens",
      "# TYPE toolyour_mcp_circuit_opens counter",
      `toolyour_mcp_circuit_opens ${c.circuitOpens}`,
      "# HELP toolyour_mcp_gateway_retries Gateway retries",
      "# TYPE toolyour_mcp_gateway_retries counter",
      `toolyour_mcp_gateway_retries ${c.gatewayRetries}`,
      "# HELP toolyour_mcp_suggest_returns suggest_task returns",
      "# TYPE toolyour_mcp_suggest_returns counter",
      `toolyour_mcp_suggest_returns ${c.suggestReturns}`,
    ];
    res.type("text/plain; version=0.0.4; charset=utf-8").send(lines.join("\n") + "\n");
  });

  app.get("/health/mcp/ready", async (_req: Request, res: Response) => {
    const env = getEnv();
    const gatewayOk = await checkGatewayHealth();
    const breaker = circuitBreaker.snapshot();
    const bothOpen = breaker.node.open && breaker.python.open;
    const ready =
      registry.isReady() &&
      defsCache.isReady() &&
      gatewayOk &&
      !!env.internalSecret &&
      !bothOpen;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      registry: registry.isReady(),
      defs: defsCache.isReady(),
      registryStaleMs: registry.staleAgeMs(),
      defsStaleMs: defsCache.staleAgeMs(),
      gateway: gatewayOk,
      validateConfigured: !!env.internalSecret,
      circuitBreaker: breaker,
    });
  });
}
