import type { StoredRun } from "./store";

/**
 * Agent-facing poll shape. `status` is the run lifecycle (accepted|running|completed|…).
 * `resultStatus` is the semantic payload status (suggest|need_input|verified|error|…).
 * Agents must read resultStatus / result.status — run status "completed" only means finished.
 */
export function serializeRunPoll(entry: StoredRun) {
  const result = entry.result ?? null;
  let resultStatus: string | null = null;
  if (result && typeof result === "object" && "status" in result) {
    const s = (result as { status?: unknown }).status;
    if (s != null && s !== "") resultStatus = String(s);
  }
  return {
    runId: entry.id,
    kind: entry.kind,
    status: entry.status,
    resultStatus,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    result,
    error: entry.error ?? null,
  };
}
