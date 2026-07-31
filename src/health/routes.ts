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
      transports: ["sse:/mcp", "http:/mcp/http"],
    });
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
