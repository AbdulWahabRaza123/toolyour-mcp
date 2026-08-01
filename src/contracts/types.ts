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
  /** One automatic retry on transient gateway failures */
  gatewayRetryCount: number;
  gatewayRetryBackoffMs: number;
  /** SSE session idle TTL before sweep */
  mcpSessionTtlMs: number;
  mcpSessionSweepMs: number;
  /** Min absolute score to auto-execute a matched task */
  taskMatchMinScore: number;
  /** If top-2 scores are within this margin, return suggest instead of execute */
  taskMatchAmbiguityMargin: number;
  /** Truncated response payload store (in-process, free) */
  dataRefTtlMs: number;
  dataRefSweepMs: number;
  dataRefMaxEntries: number;
  dataRefMaxTotalBytes: number;
  /** Max in-flight gateway fetches per MCP process (free backpressure). */
  gatewayMaxConcurrent: number;
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
  /** Optional backing workflow for run_playbook */
  workflowId?: string;
}

export interface McpWorkflowStep {
  id: string;
  operationId: string;
  inputFrom?: string;
  inputMap?: Record<string, string>;
  /** When true, step failure is recorded but workflow continues */
  continueOnError?: boolean;
}

export interface ContentAdapterDef {
  id: string;
  keywords: string[];
  taskIds?: string[];
  workflowIds?: string[];
  urlOperationIds?: string[];
  localHandlers?: string[];
  textPipeline?: string[];
  inputKinds?: Array<"html" | "text" | "code">;
}

export interface McpWorkflowDef {
  id: string;
  title: string;
  description: string;
  /** Merges multi-step outputs into toolyour.jobReport@1 for agents */
  synthesizer?: string;
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
