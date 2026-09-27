import { getEnv } from "../config";
import { parseRepositoryPolicy, type RepositoryPolicy } from "../github/repository-policy";

/** Internal-only policy lookup. A missing policy means conservative defaults still apply. */
export async function loadRepositoryPolicy(ownerKey: string, repository: string): Promise<RepositoryPolicy | null> {
  const secret = getEnv().internalSecret;
  if (!secret) return null;
  const url = new URL(getEnv().repositoryPoliciesUrl);
  url.searchParams.set("ownerKey", ownerKey);
  url.searchParams.set("repository", repository);
  try {
    const response = await fetch(url, { headers: { "X-SaaS-Secret": secret } });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const body = await response.json() as { policy?: unknown };
    return parseRepositoryPolicy(body.policy, repository);
  } catch {
    return null;
  }
}
