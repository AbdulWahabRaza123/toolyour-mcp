import { createSign } from "crypto";
import type { PullRequestRef } from "./pr-evidence";

export class GitHubAppAuthError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type FetchLike = typeof fetch;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function appJwt(appId: string, privateKey: string, nowMs: number): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iss: appId, iat: Math.floor(nowMs / 1000) - 30, exp: Math.floor(nowMs / 1000) + 9 * 60 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey, "base64url")}`;
}

export type GitHubAppTokenProvider = {
  getInstallationToken(ref: PullRequestRef): Promise<string>;
};

/**
 * Exchanges a GitHub App private key for short-lived, repository-scoped
 * installation tokens. Tokens are held only in process memory and never
 * returned in evidence or WorkRecords.
 */
export function createGitHubAppTokenProvider(opts: {
  appId: string;
  privateKey: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): GitHubAppTokenProvider {
  const appId = opts.appId.trim();
  const privateKey = opts.privateKey.replace(/\\n/g, "\n").trim();
  if (!appId || !privateKey) throw new GitHubAppAuthError("GitHub App ID and private key are required");
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const cache = new Map<number, { token: string; expiresAt: number }>();

  async function request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, init);
    } catch {
      throw new GitHubAppAuthError("GitHub App authentication could not reach GitHub");
    }
    if (!response.ok) throw new GitHubAppAuthError(`GitHub App authentication failed (${response.status})`);
    const parsed = await response.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  }

  return {
    async getInstallationToken(ref: PullRequestRef): Promise<string> {
      const jwt = appJwt(appId, privateKey, now());
      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const installation = await request(
        `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/installation`,
        { headers }
      );
      const installationId = Number(installation.id);
      if (!Number.isInteger(installationId) || installationId <= 0) throw new GitHubAppAuthError("GitHub did not return an installation ID");
      const cached = cache.get(installationId);
      if (cached && cached.expiresAt > now() + 60_000) return cached.token;
      const tokenResponse = await request(`/app/installations/${installationId}/access_tokens`, { method: "POST", headers });
      const token = typeof tokenResponse.token === "string" ? tokenResponse.token : "";
      const expiresAt = Date.parse(typeof tokenResponse.expires_at === "string" ? tokenResponse.expires_at : "");
      if (!token || !Number.isFinite(expiresAt)) throw new GitHubAppAuthError("GitHub did not return a usable installation token");
      cache.set(installationId, { token, expiresAt });
      return token;
    },
  };
}
