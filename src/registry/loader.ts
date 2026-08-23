import fs from "fs";
import path from "path";
import { constants, getEnv, loadManifestFile } from "../config";
import type { McpRegistryManifest, McpToolRoute } from "../contracts";
import type { Logger } from "../observability/logger";
import { scoreFuzzyQuery } from "../search/fuzzy-search";
import { expandQueryForDiscovery } from "../search/query-expand";

export class RegistryLoader {
  private manifest: McpRegistryManifest | null = null;
  private loadedAt = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private logger: Logger) {}

  start() {
    this.reload();
    this.refreshTimer = setInterval(
      () => this.reload(true),
      constants.registryRefreshSeconds * 1000
    );
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  reload(silent = false) {
    const env = getEnv();
    try {
      if (!fs.existsSync(env.registryPath)) {
        throw new Error(`Registry not found: ${env.registryPath}`);
      }
      this.manifest = loadManifestFile(env.registryPath);
      this.loadedAt = Date.now();
      if (!silent) {
        this.logger.info("registry loaded", {
          tools: this.manifest.stats.hasApiIncluded,
        });
      }
    } catch (e) {
      this.logger.error("registry load failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      if (!this.manifest) throw e;
    }
  }

  isReady(): boolean {
    return this.manifest !== null;
  }

  getManifest(): McpRegistryManifest {
    if (!this.manifest) throw new Error("Registry not loaded");
    return this.manifest;
  }

  getRoute(operationId: string): McpToolRoute | undefined {
    return this.getManifest().routes[operationId];
  }

  hasOperation(operationId: string): boolean {
    return !!this.getRoute(operationId);
  }

  getSchema(operationId: string): unknown | null {
    const env = getEnv();
    const p = path.join(env.schemasDir, `${operationId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  staleAgeMs(): number {
    return Date.now() - this.loadedAt;
  }
}

export function searchTools(
  registry: McpRegistryManifest,
  query: string,
  category?: string,
  limit = constants.defaultDiscoverLimit
) {
  const q = query.trim().toLowerCase();
  const max = Math.min(limit, constants.maxDiscoverLimit);
  let items = registry.tools;

  if (category) {
    const c = category.toLowerCase();
    items = items.filter((t) => t.category.toLowerCase() === c);
  }

  if (!q) {
    return items.slice(0, max);
  }

  const queries = expandQueryForDiscovery(q);
  const scored = items
    .map((t) => {
      const fields = [t.operationId, t.name, t.description, t.category];
      const weights = [1.4, 1.2, 0.8, 0.5];
      let score = 0;
      for (const variant of queries) {
        score = Math.max(score, scoreFuzzyQuery(variant, fields, weights));
      }
      return { tool: t, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map((row) => row.tool);
}
