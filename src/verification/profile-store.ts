import { getEnv } from "../config";
import type { Logger } from "../observability/logger";

export type VerificationProfileRecord = {
  profile: {
    profileId: string;
    targetUrl: string;
    playbook: string;
    label?: string;
    lastPassAt?: string | null;
    lastPassRunId?: string | null;
    lastPassGate?: string | null;
    hasLastPassSnapshot: boolean;
    hasLastRunSnapshot: boolean;
  };
  lastPassSnapshot: Record<string, unknown> | null;
  lastRunSnapshot: Record<string, unknown> | null;
};

class ProfileStoreError extends Error {
  code: "not_found" | "unavailable";
  constructor(code: "not_found" | "unavailable", message: string) {
    super(message);
    this.code = code;
  }
}

async function internalFetch(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const secret = getEnv().internalSecret;
  if (!secret) {
    throw new ProfileStoreError("unavailable", "SAAS_INTERNAL_SECRET is not configured");
  }
  const base = getEnv().verificationProfilesUrl.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  try {
    return await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SaaS-Secret": secret,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ProfileStoreError("unavailable", "Verification profile store unavailable");
  }
}

export async function createProfile(opts: {
  userId: string;
  apiKeyId: string;
  targetUrl: string;
  playbook: string;
  label?: string;
}): Promise<VerificationProfileRecord> {
  const res = await internalFetch("POST", "", {
    userId: opts.userId,
    apiKeyId: opts.apiKeyId,
    targetUrl: opts.targetUrl,
    playbook: opts.playbook,
    label: opts.label,
  });
  if (!res.ok) {
    throw new ProfileStoreError("unavailable", `profile create failed (${res.status})`);
  }
  const parsed = (await res.json()) as VerificationProfileRecord;
  return parsed;
}

export async function getProfile(
  profileId: string,
  apiKeyId: string
): Promise<VerificationProfileRecord | null> {
  const res = await internalFetch(
    "GET",
    `/${encodeURIComponent(profileId)}?apiKeyId=${encodeURIComponent(apiKeyId)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ProfileStoreError("unavailable", `profile read failed (${res.status})`);
  }
  return (await res.json()) as VerificationProfileRecord;
}

export async function patchProfileSnapshots(opts: {
  profileId: string;
  apiKeyId: string;
  lastRunSnapshot?: Record<string, unknown>;
  lastPassSnapshot?: Record<string, unknown>;
  lastPassRunId?: string;
  lastPassGate?: string;
  logger?: Logger;
}): Promise<void> {
  const res = await internalFetch("PATCH", `/${encodeURIComponent(opts.profileId)}`, {
    apiKeyId: opts.apiKeyId,
    lastRunSnapshot: opts.lastRunSnapshot,
    lastPassSnapshot: opts.lastPassSnapshot,
    lastPassRunId: opts.lastPassRunId,
    lastPassGate: opts.lastPassGate,
  });
  if (res.status === 404) {
    throw new ProfileStoreError("not_found", `profile not found: ${opts.profileId}`);
  }
  if (!res.ok) {
    opts.logger?.warn("verification profile patch failed", { status: res.status });
    throw new ProfileStoreError("unavailable", `profile patch failed (${res.status})`);
  }
}

export { ProfileStoreError };
