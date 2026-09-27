import { getEnv } from "../config";
import { hashCanonical } from "../control-plane/hash";
import { loadWorkRecord } from "./store-saas";

export async function requestWorkApproval(opts: { workId: string; ownerKey: string; summary?: string; expiresInHours?: number }): Promise<Record<string, unknown>> {
  const work = await loadWorkRecord(opts.workId);
  if (!work || work.ownerKey !== opts.ownerKey) throw new Error("work record not found");
  const latest = work.latest && typeof work.latest === "object" ? work.latest as Record<string, unknown> : null;
  const evidence = latest?.evidence && typeof latest.evidence === "object" ? latest.evidence as Record<string, unknown> : null;
  const pullRequest = evidence?.pullRequest && typeof evidence.pullRequest === "object" ? evidence.pullRequest as Record<string, unknown> : null;
  if (!evidence || !pullRequest || typeof pullRequest.headSha !== "string") throw new Error("work record has no immutable pull-request evidence");
  const secret = getEnv().internalSecret;
  if (!secret) throw new Error("approval store is not configured");
  const response = await fetch(getEnv().approvalRequestsUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-SaaS-Secret": secret }, body: JSON.stringify({ request: { ownerKey: opts.ownerKey, workId: opts.workId, subject: pullRequest, evidenceDigest: hashCanonical(evidence), summary: opts.summary, expiresInHours: opts.expiresInHours } }) });
  if (!response.ok) throw new Error("approval request could not be created");
  const body = await response.json() as { approval?: unknown };
  if (!body.approval || typeof body.approval !== "object") throw new Error("approval store returned an invalid request");
  return body.approval as Record<string, unknown>;
}
