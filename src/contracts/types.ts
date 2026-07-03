export interface McpConstants {
  schemaVersion: string;
  serverName: string;
  serverVersion: string;
  defaultDiscoverLimit: number;
  maxDiscoverLimit: number;
  sessionCacheTtlSeconds: number;
  registryRefreshSeconds: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerWindowMs: number;
  circuitBreakerOpenMs: number;
  summarizeThresholdBytes: number;
  summarizedMaxBytes: number;
  gatewayTimeoutMs: number;
  discoverCacheTtlSeconds: number;
}

export interface McpErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  suggestedTool?: string;
}

export interface McpToolCard {
  operationId: string;
  name: string;
  category: string;
  description: string;
  inputShape: "json" | "multipart" | "query";
  backend: "node" | "python";
}

export interface McpToolRoute {
  operationId: string;
  method: string;
  gatewayPath: string;
  category: string;
  name: string;
  description: string;
  backend: "node" | "python";
  multipart?: boolean;
  fileField?: string;
  jsonBody?: boolean;
  responseHint?: string;
  validatePaths: string[];
}

export interface McpRegistryManifest {
  schemaVersion: string;
  generatedAt: string;
  stats: {
    totalOpenApiRoutes: number;
    hasApiIncluded: number;
    excluded: number;
  };
  categories: string[];
  tools: McpToolCard[];
  routes: Record<string, McpToolRoute>;
}

export interface McpSkillMeta {
  id: string;
  title: string;
  category: string;
  description: string;
  operationIds: string[];
}

export interface McpWorkflowStep {
  id: string;
  operationId: string;
  inputFrom?: string;
  inputMap?: Record<string, string>;
}

export interface McpWorkflowDef {
  id: string;
  title: string;
  description: string;
  steps: McpWorkflowStep[];
}

export interface McpTaskDef {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  type: "workflow" | "tool" | "local";
  target: string;
  requiredInput?: string[];
}
