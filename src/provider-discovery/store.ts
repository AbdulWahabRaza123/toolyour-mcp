import { getEnv } from "../config";

export class ProviderDiscoveryError extends Error {
  constructor(
    public readonly code: "not_found" | "unavailable",
    message: string
  ) {
    super(message);
  }
}

function discoveryBaseUrl(): string {
  return `${getEnv().actionRegistryUrl}/provider-discovery`;
}

async function discoveryFetch(path: string, userId: string): Promise<Record<string, unknown>> {
  const env = getEnv();
  if (!env.internalSecret) {
    throw new ProviderDiscoveryError("unavailable", "Provider discovery is unavailable");
  }
  const url = new URL(`${discoveryBaseUrl()}${path}`);
  url.searchParams.set("userId", userId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-SaaS-Secret": env.internalSecret },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ProviderDiscoveryError("unavailable", "Provider discovery is unavailable");
  }
  if (response.status === 404) {
    throw new ProviderDiscoveryError("not_found", "Approved provider operation not found");
  }
  if (!response.ok) {
    throw new ProviderDiscoveryError("unavailable", "Provider discovery is unavailable");
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function listProviderProjects(userId: string) {
  return discoveryFetch("/projects", userId);
}

export async function searchProviderOperations(input: {
  userId: string;
  query: string;
  projectId?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({ query: input.query });
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.limit) params.set("limit", String(input.limit));
  return discoveryFetch(`/operations?${params.toString()}`, input.userId);
}

export async function getProviderOperation(input: {
  userId: string;
  projectId: string;
  operationId: string;
}) {
  return discoveryFetch(
    `/projects/${encodeURIComponent(input.projectId)}/operations/${encodeURIComponent(input.operationId)}`,
    input.userId
  );
}
