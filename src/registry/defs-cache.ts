import fs from "fs";
import { constants, getEnv } from "../config";
import type { ContentAdapterDef, McpTaskDef, McpWorkflowDef } from "../contracts";
import type { Logger } from "../observability/logger";

/**
 * In-memory cache for tasks / workflows / content-adapters.
 * Refreshed on the same cadence as the OpenAPI tool manifest.
 */
export class DefsCache {
  private tasks: McpTaskDef[] = [];
  private workflows: McpWorkflowDef[] = [];
  private adapters: ContentAdapterDef[] = [];
  private loadedAt = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger | null = null;

  start(logger?: Logger) {
    this.logger = logger ?? null;
    this.reload();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(
      () => this.reload(true),
      constants.registryRefreshSeconds * 1000
    );
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  reload(silent = false) {
    const env = getEnv();
    try {
      this.tasks = readTasks(env.tasksPath);
      this.workflows = readWorkflows(env.workflowsPath);
      this.adapters = readAdapters(env.contentAdaptersPath);
      this.loadedAt = Date.now();
      if (!silent) {
        this.logger?.info("defs cache loaded", {
          tasks: this.tasks.length,
          workflows: this.workflows.length,
          adapters: this.adapters.length,
        });
      }
    } catch (e) {
      this.logger?.error("defs cache load failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      if (this.loadedAt === 0) {
        this.tasks = [];
        this.workflows = [];
        this.adapters = [];
      }
    }
  }

  getTasks(): McpTaskDef[] {
    if (this.loadedAt === 0) this.reload(true);
    return this.tasks;
  }

  getWorkflows(): McpWorkflowDef[] {
    if (this.loadedAt === 0) this.reload(true);
    return this.workflows;
  }

  getWorkflow(id: string): McpWorkflowDef | undefined {
    return this.getWorkflows().find((w) => w.id === id);
  }

  getContentAdapters(): ContentAdapterDef[] {
    if (this.loadedAt === 0) this.reload(true);
    return this.adapters;
  }

  staleAgeMs(): number {
    return this.loadedAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - this.loadedAt;
  }

  isReady(): boolean {
    return this.loadedAt > 0;
  }
}

function readTasks(tasksPath: string): McpTaskDef[] {
  if (!fs.existsSync(tasksPath)) return [];
  const raw = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
  return Array.isArray(raw.tasks) ? raw.tasks : [];
}

function readWorkflows(workflowsPath: string): McpWorkflowDef[] {
  if (!fs.existsSync(workflowsPath)) return [];
  const raw = JSON.parse(fs.readFileSync(workflowsPath, "utf8"));
  return Array.isArray(raw.workflows) ? raw.workflows : [];
}

function readAdapters(adaptersPath: string): ContentAdapterDef[] {
  if (!fs.existsSync(adaptersPath)) return [];
  const raw = JSON.parse(fs.readFileSync(adaptersPath, "utf8"));
  return Array.isArray(raw.adapters) ? raw.adapters : [];
}

/** Process-wide singleton — started from server.ts */
export const defsCache = new DefsCache();
