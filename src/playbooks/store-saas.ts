import { getEnv } from "../config";

export class SavedPlaybookStoreError extends Error {}

async function request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const secret = getEnv().internalSecret;
  if (!secret) throw new SavedPlaybookStoreError("Saved Playbooks beta is not configured");
  let response: Response;
  try { response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "X-SaaS-Secret": secret, ...(init.headers || {}) } }); }
  catch { throw new SavedPlaybookStoreError("Saved Playbooks storage is unavailable"); }
  if (response.status === 404) throw new SavedPlaybookStoreError("not_found");
  if (!response.ok) throw new SavedPlaybookStoreError(`Saved Playbooks storage failed (${response.status})`);
  const body = await response.json();
  if (!body || typeof body !== "object") throw new SavedPlaybookStoreError("Saved Playbooks storage returned an invalid response");
  return body as Record<string, unknown>;
}

export const createSavedPlaybook = (playbook: Record<string, unknown>) => request(getEnv().savedPlaybooksUrl, { method: "POST", body: JSON.stringify({ playbook }) });
export const listSavedPlaybooks = (ownerKey: string, status?: string) => { const url = new URL(getEnv().savedPlaybooksUrl); url.searchParams.set("ownerKey", ownerKey); if (status) url.searchParams.set("status", status); return request(url.toString(), { method: "GET" }); };
export const getSavedPlaybook = (playbookId: string, ownerKey: string) => { const url = new URL(`${getEnv().savedPlaybooksUrl}/${encodeURIComponent(playbookId)}`); url.searchParams.set("ownerKey", ownerKey); return request(url.toString(), { method: "GET" }); };
export const updateSavedPlaybook = (playbookId: string, playbook: Record<string, unknown>) => request(`${getEnv().savedPlaybooksUrl}/${encodeURIComponent(playbookId)}`, { method: "PATCH", body: JSON.stringify({ playbook }) });
export const createPlaybookRun = (run: Record<string, unknown>) => request(getEnv().playbookRunsUrl, { method: "POST", body: JSON.stringify({ run }) });
export const finishPlaybookRun = (playbookRunId: string, run: Record<string, unknown>) => request(`${getEnv().playbookRunsUrl}/${encodeURIComponent(playbookRunId)}`, { method: "PATCH", body: JSON.stringify({ run }) });
export const getPlaybookRun = (playbookRunId: string, ownerKey: string) => { const url = new URL(`${getEnv().playbookRunsUrl}/${encodeURIComponent(playbookRunId)}`); url.searchParams.set("ownerKey", ownerKey); return request(url.toString(), { method: "GET" }); };
