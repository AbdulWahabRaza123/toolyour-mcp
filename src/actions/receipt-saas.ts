import { createHash } from "crypto";
import { getEnv } from "../config";
import type { ActionContract } from "./types";
import type { Logger } from "../observability/logger";

function enabled(): boolean {
  return String(process.env.ACTION_REGISTRY_BETA || "").trim().toLowerCase() === "true";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

async function internalFetch(path: string, body: Record<string, unknown>, method: "POST" | "PATCH" = "POST"): Promise<Record<string, unknown> | null> {
  const env = getEnv();
  if (!env.internalSecret) return null;
  const response = await fetch(`${env.actionRegistryUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-SaaS-Secret": env.internalSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) return null;
  const value = await response.json();
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * Beta-only audit bridge. It is deliberately best-effort: registry telemetry
 * must never make an established public MCP action fail or retry.
 */
export async function recordNativeActionSuccess(opts: {
  ownerKey: string;
  contract: ActionContract;
  requestId: string;
  workId?: string;
  input: Record<string, unknown>;
  result: unknown;
  logger: Logger;
}): Promise<void> {
  if (!enabled()) return;
  try {
    const ensured = await internalFetch("/actions/ensure-native", {
      action: { ownerKey: opts.ownerKey, sourceKey: opts.contract.id, contract: opts.contract },
    });
    const action = ensured?.action as Record<string, unknown> | undefined;
    const actionId = typeof action?.actionId === "string" ? action.actionId : "";
    const actionVersion = typeof action?.currentVersion === "number" ? action.currentVersion : 1;
    if (!actionId) throw new Error("action registry did not return an action id");
    const created = await internalFetch("/action-receipts", {
      receipt: {
        ownerKey: opts.ownerKey,
        actionId,
        actionVersion,
        idempotencyKey: opts.requestId,
        inputFingerprint: fingerprint(opts.input),
        ...(opts.workId ? { workId: opts.workId } : {}),
      },
    });
    const receipt = created?.receipt as Record<string, unknown> | undefined;
    const receiptId = typeof receipt?.receiptId === "string" ? receipt.receiptId : "";
    if (!receiptId) throw new Error("action registry did not return a receipt id");
    await internalFetch(`/action-receipts/${encodeURIComponent(receiptId)}`, {
      receipt: {
        ownerKey: opts.ownerKey,
        status: "completed",
        evidenceRefs: [`gateway:${opts.contract.providerRef}:${opts.requestId}`],
        resultDigest: fingerprint(opts.result),
      },
    }, "PATCH");
  } catch (error) {
    opts.logger.warn("action receipt capture failed (ignored)", {
      operationId: opts.contract.providerRef,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
