import { getEnv } from "../config";

export class WorkRecordStoreError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Internal-only persistence client. It sends WorkRecords, never GitHub credentials. */
export async function saveWorkRecord(record: Record<string, unknown>, mustExist = false): Promise<Record<string, unknown>> {
  const workId = typeof record.workId === "string" ? record.workId : "";
  const secret = getEnv().internalSecret;
  if (!workId || !secret) throw new WorkRecordStoreError("WorkRecord storage is not configured");
  const url = new URL(`${getEnv().workRecordsUrl}/${encodeURIComponent(workId)}`);
  if (mustExist) url.searchParams.set("mustExist", "1");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-SaaS-Secret": secret },
      body: JSON.stringify({ work: record }),
    });
  } catch {
    throw new WorkRecordStoreError("WorkRecord storage is unavailable");
  }
  if (!response.ok) throw new WorkRecordStoreError(`WorkRecord storage failed (${response.status})`);
  const payload = await response.json() as { work?: unknown };
  if (!payload.work || typeof payload.work !== "object") throw new WorkRecordStoreError("WorkRecord storage returned an invalid document");
  return payload.work as Record<string, unknown>;
}

export async function loadWorkRecord(workId: string): Promise<Record<string, unknown> | null> {
  const secret = getEnv().internalSecret;
  if (!secret) throw new WorkRecordStoreError("WorkRecord storage is not configured");
  let response: Response;
  try { response = await fetch(`${getEnv().workRecordsUrl}/${encodeURIComponent(workId)}`, { headers: { "X-SaaS-Secret": secret } }); }
  catch { throw new WorkRecordStoreError("WorkRecord storage is unavailable"); }
  if (response.status === 404) return null;
  if (!response.ok) throw new WorkRecordStoreError(`WorkRecord storage failed (${response.status})`);
  const body = await response.json() as { work?: unknown };
  return body.work && typeof body.work === "object" ? body.work as Record<string, unknown> : null;
}
