import { getEnv } from "../config";
import type { Logger } from "../observability/logger";

export type FeatureMemoryRecord = {
  schemaVersion: "toolyour.featureMemory@1";
  featureId: string;
  domain: string;
  title: string;
  requirements: string;
  projectName?: string;
  repoHint?: string;
  capabilities: Array<{ id: string; label: string; status: string; notes?: string }>;
  evaluationMatrix: Record<
    string,
    { label: string; score: number; status: string; notes?: string }
  >;
  compositeScore: number;
  iterationCount: number;
  bestInDomain: boolean;
  supersedesFeatureId?: string | null;
  event: string;
  outcomesSummary?: string;
  verificationGate?: string | null;
  capturedAt?: string;
  updatedAt?: string;
  matchScore?: number;
  visibility?: "private" | "community";
  communitySlug?: string;
  publishedAt?: string;
};

class FeatureMemoryStoreError extends Error {
  code: "not_found" | "unavailable";
  constructor(code: "not_found" | "unavailable", message: string) {
    super(message);
    this.code = code;
  }
}

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function internalFetch(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const secret = getEnv().internalSecret;
  if (!secret) {
    throw new FeatureMemoryStoreError("unavailable", "SAAS_INTERNAL_SECRET is not configured");
  }
  const base = getEnv().featureMemoryUrl.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < FETCH_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-SaaS-Secret": secret,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok || res.status === 404) return res;
      if (res.status >= 500 && attempt < FETCH_MAX_ATTEMPTS - 1) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < FETCH_MAX_ATTEMPTS - 1) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }
  throw new FeatureMemoryStoreError(
    "unavailable",
    lastError?.message || "Feature memory store unavailable"
  );
}

export async function matchFeatures(opts: {
  userId: string;
  goal: string;
  requirements?: string;
  domain?: string;
  limit?: number;
  includeCommunity?: boolean;
}): Promise<{
  domain: string;
  matches: FeatureMemoryRecord[];
  bestInDomain?: FeatureMemoryRecord | null;
  communityPatterns?: FeatureMemoryRecord[];
  matchMethod?: "hybrid_embedding";
}> {
  const res = await internalFetch("POST", "/match", {
    userId: opts.userId,
    goal: opts.goal,
    requirements: opts.requirements,
    domain: opts.domain,
    limit: opts.limit,
    includeCommunity: opts.includeCommunity,
  });
  if (!res.ok) {
    throw new FeatureMemoryStoreError("unavailable", `feature match failed (${res.status})`);
  }
  return (await res.json()) as {
    domain: string;
    matches: FeatureMemoryRecord[];
    bestInDomain?: FeatureMemoryRecord | null;
    communityPatterns?: FeatureMemoryRecord[];
    matchMethod?: "hybrid_embedding";
  };
}

export async function listFeatures(opts: {
  userId: string;
  domain?: string;
  limit?: number;
}): Promise<FeatureMemoryRecord[]> {
  const params = new URLSearchParams({
    userId: opts.userId,
    limit: String(opts.limit ?? 20),
  });
  if (opts.domain) params.set("domain", opts.domain);
  const res = await internalFetch("GET", `?${params.toString()}`);
  if (!res.ok) {
    throw new FeatureMemoryStoreError("unavailable", `feature list failed (${res.status})`);
  }
  const parsed = (await res.json()) as { features: FeatureMemoryRecord[] };
  return parsed.features || [];
}

export async function createFeature(opts: {
  userId: string;
  apiKeyId: string;
  domain: string;
  title: string;
  requirements: string;
  projectName?: string;
  repoHint?: string;
  capabilities?: FeatureMemoryRecord["capabilities"];
  evaluationMatrix?: FeatureMemoryRecord["evaluationMatrix"];
  compositeScore?: number;
  outcomesSummary?: string;
  verificationGate?: string;
  event?: string;
  supersedesFeatureId?: string;
  logger?: Logger;
}): Promise<{ feature: FeatureMemoryRecord; superseded?: FeatureMemoryRecord | null }> {
  const res = await internalFetch("POST", "", { ...opts });
  if (!res.ok) {
    opts.logger?.warn("feature memory create failed", { status: res.status });
    throw new FeatureMemoryStoreError("unavailable", `feature create failed (${res.status})`);
  }
  return (await res.json()) as {
    feature: FeatureMemoryRecord;
    superseded?: FeatureMemoryRecord | null;
  };
}

export async function updateFeature(opts: {
  featureId: string;
  userId: string;
  apiKeyId: string;
  title?: string;
  requirements?: string;
  projectName?: string;
  capabilities?: FeatureMemoryRecord["capabilities"];
  evaluationMatrix?: FeatureMemoryRecord["evaluationMatrix"];
  compositeScore?: number;
  outcomesSummary?: string;
  verificationGate?: string;
  event?: string;
  logger?: Logger;
}): Promise<FeatureMemoryRecord | null> {
  const { featureId, logger, ...body } = opts;
  const res = await internalFetch("PATCH", `/${encodeURIComponent(featureId)}`, body);
  if (res.status === 404) return null;
  if (!res.ok) {
    logger?.warn("feature memory update failed", { status: res.status });
    throw new FeatureMemoryStoreError("unavailable", `feature update failed (${res.status})`);
  }
  const parsed = (await res.json()) as { feature: FeatureMemoryRecord };
  return parsed.feature;
}

export async function publishFeature(opts: {
  featureId: string;
  userId: string;
  logger?: Logger;
}): Promise<FeatureMemoryRecord | null> {
  const res = await internalFetch("POST", `/${encodeURIComponent(opts.featureId)}/publish`, {
    userId: opts.userId,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    opts.logger?.warn("feature memory publish failed", { status: res.status });
    throw new FeatureMemoryStoreError("unavailable", `feature publish failed (${res.status})`);
  }
  const parsed = (await res.json()) as { feature: FeatureMemoryRecord };
  return parsed.feature;
}

export async function unpublishFeature(opts: {
  featureId: string;
  userId: string;
  logger?: Logger;
}): Promise<FeatureMemoryRecord | null> {
  const res = await internalFetch("POST", `/${encodeURIComponent(opts.featureId)}/unpublish`, {
    userId: opts.userId,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    opts.logger?.warn("feature memory unpublish failed", { status: res.status });
    throw new FeatureMemoryStoreError("unavailable", `feature unpublish failed (${res.status})`);
  }
  const parsed = (await res.json()) as { feature: FeatureMemoryRecord };
  return parsed.feature;
}

export async function deleteFeature(opts: {
  featureId: string;
  userId: string;
  logger?: Logger;
}): Promise<boolean> {
  const res = await internalFetch("DELETE", `/${encodeURIComponent(opts.featureId)}`, {
    userId: opts.userId,
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    opts.logger?.warn("feature memory delete failed", { status: res.status });
    throw new FeatureMemoryStoreError("unavailable", `feature delete failed (${res.status})`);
  }
  return true;
}

export async function compareFeaturePair(opts: {
  userId: string;
  featureIdA: string;
  featureIdB: string;
}): Promise<{ a: FeatureMemoryRecord; b: FeatureMemoryRecord } | null> {
  const res = await internalFetch("POST", "/actions/compare", {
    userId: opts.userId,
    featureIdA: opts.featureIdA,
    featureIdB: opts.featureIdB,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new FeatureMemoryStoreError("unavailable", `feature compare failed (${res.status})`);
  }
  return (await res.json()) as { a: FeatureMemoryRecord; b: FeatureMemoryRecord };
}

export async function listCommunityPatterns(opts: {
  domain?: string;
  limit?: number;
}): Promise<FeatureMemoryRecord[]> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) });
  if (opts.domain) params.set("domain", opts.domain);
  const res = await internalFetch("GET", `/community/patterns?${params.toString()}`);
  if (!res.ok) {
    throw new FeatureMemoryStoreError("unavailable", `community list failed (${res.status})`);
  }
  const parsed = (await res.json()) as { patterns: FeatureMemoryRecord[] };
  return parsed.patterns || [];
}

export { FeatureMemoryStoreError };
