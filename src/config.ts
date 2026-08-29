import fs from "fs";
import path from "path";
import type { McpConstants, McpRegistryManifest } from "./contracts";

const defaults: McpConstants = {
  schemaVersion: "1.0.0",
  serverName: "toolyour",
  serverVersion: "1.0.0",
  defaultDiscoverLimit: 10,
  maxDiscoverLimit: 25,
  sessionCacheTtlSeconds: 900,
  registryRefreshSeconds: 300,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerWindowMs: 30000,
  circuitBreakerOpenMs: 30000,
  summarizeThresholdBytes: 8192,
  summarizedMaxBytes: 4096,
  gatewayTimeoutMs: 120000,
  discoverCacheTtlSeconds: 60,
  gatewayRetryCount: 1,
  gatewayRetryBackoffMs: 400,
  mcpSessionTtlMs: 30 * 60 * 1000,
  mcpSessionSweepMs: 60 * 1000,
  taskMatchMinScore: 2,
  taskMatchAmbiguityMargin: 2,
  dataRefTtlMs: 15 * 60 * 1000,
  dataRefSweepMs: 60 * 1000,
  dataRefMaxEntries: 200,
  dataRefMaxTotalBytes: 32 * 1024 * 1024,
  gatewayMaxConcurrent: Math.max(
    1,
    Number(process.env.GATEWAY_MAX_CONCURRENT || 24)
  ),
};

function loadJsonConstants(): Partial<McpConstants> {
  const candidates = [
    path.join(__dirname, "..", "..", "shared", "mcp", "constants.json"),
    path.join(__dirname, "..", "..", "..", "shared", "mcp", "constants.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as Partial<McpConstants>;
    }
  }
  return {};
}

export const constants: McpConstants = {
  ...defaults,
  ...loadJsonConstants(),
  serverVersion: process.env.MCP_SERVER_VERSION || defaults.serverVersion,
};

export function getEnv() {
  const validateUrl =
    process.env.SAAS_VALIDATE_URL ||
    "http://127.0.0.1:3002/internal/validate-key";
  const saasInternalBase = validateUrl.replace(/\/validate-key\/?$/, "");
  return {
    port: Number(process.env.PORT || 3090),
    gatewayUrl: (process.env.GATEWAY_URL || "http://127.0.0.1:8888").replace(/\/$/, ""),
    validateUrl,
    mcpJobWebhookConfigUrl:
      process.env.SAAS_MCP_JOB_WEBHOOK_URL ||
      `${saasInternalBase}/mcp-job-webhook`,
    controlPlaneJobsUrl:
      process.env.CONTROL_PLANE_JOBS_URL?.replace(/\/$/, "") ||
      `${saasInternalBase}/control-plane/jobs`,
    verificationProfilesUrl:
      process.env.VERIFICATION_PROFILES_URL?.replace(/\/$/, "") ||
      `${saasInternalBase}/verification-profiles`,
    featureMemoryUrl:
      process.env.FEATURE_MEMORY_URL?.replace(/\/$/, "") ||
      `${saasInternalBase}/feature-memory`,
    internalSecret: process.env.SAAS_INTERNAL_SECRET || "",
    registryPath:
      process.env.REGISTRY_PATH ||
      path.join(__dirname, "..", "registry", "manifest.json"),
    schemasDir:
      process.env.SCHEMAS_DIR ||
      path.join(__dirname, "..", "registry", "schemas"),
    skillsDir: process.env.SKILLS_DIR || path.join(__dirname, "..", "skills"),
    workflowsPath:
      process.env.WORKFLOWS_PATH ||
      path.join(__dirname, "..", "registry", "workflows.json"),
    tasksPath:
      process.env.TASKS_PATH ||
      path.join(__dirname, "..", "registry", "tasks.json"),
    contentAdaptersPath:
      process.env.CONTENT_ADAPTERS_PATH ||
      path.join(__dirname, "..", "registry", "content-adapters.json"),
    logLevel: process.env.LOG_LEVEL || "info",
  };
}

export type AppEnv = ReturnType<typeof getEnv>;

export function loadManifestFile(registryPath: string): McpRegistryManifest {
  const raw = fs.readFileSync(registryPath, "utf8");
  return JSON.parse(raw) as McpRegistryManifest;
}
