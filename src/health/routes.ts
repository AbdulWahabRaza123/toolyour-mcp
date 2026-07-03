import type { Express, Request, Response } from "express";
import { RegistryLoader } from "../registry/loader";
import { checkGatewayHealth } from "../gateway/client";
import { getEnv } from "../config";

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
    });
  });

  app.get("/health/mcp/ready", async (_req: Request, res: Response) => {
    const env = getEnv();
    const gatewayOk = await checkGatewayHealth();
    const ready = registry.isReady() && gatewayOk && !!env.internalSecret;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      registry: registry.isReady(),
      gateway: gatewayOk,
      validateConfigured: !!env.internalSecret,
    });
  });
}
