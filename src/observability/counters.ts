export type McpCounterKey =
  | "invokes"
  | "workflowCompleted"
  | "workflowPartial"
  | "circuitOpens"
  | "truncations"
  | "gatewayRetries"
  | "authCacheHits"
  | "authCacheMisses"
  | "suggestReturns"
  | "dataRefsStored"
  | "dataRefsFetched";

const counts = new Map<McpCounterKey, number>();

export function incr(key: McpCounterKey, by = 1) {
  counts.set(key, (counts.get(key) || 0) + by);
}

export function getCounters(): Record<McpCounterKey, number> {
  return {
    invokes: counts.get("invokes") || 0,
    workflowCompleted: counts.get("workflowCompleted") || 0,
    workflowPartial: counts.get("workflowPartial") || 0,
    circuitOpens: counts.get("circuitOpens") || 0,
    truncations: counts.get("truncations") || 0,
    gatewayRetries: counts.get("gatewayRetries") || 0,
    authCacheHits: counts.get("authCacheHits") || 0,
    authCacheMisses: counts.get("authCacheMisses") || 0,
    suggestReturns: counts.get("suggestReturns") || 0,
    dataRefsStored: counts.get("dataRefsStored") || 0,
    dataRefsFetched: counts.get("dataRefsFetched") || 0,
  };
}

export function resetCounters() {
  counts.clear();
}
