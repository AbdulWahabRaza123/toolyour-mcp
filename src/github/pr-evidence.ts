/**
 * Read-only GitHub pull-request evidence collector.
 *
 * It intentionally has no MCP registration and accepts a token only at call
 * time. A future GitHub App adapter can supply short-lived installation tokens
 * without changing the evidence contract.
 */

export type PullRequestRef = { owner: string; repo: string; number: number };

export type GitHubEvidence = {
  source: "github";
  pullRequest: {
    url: string;
    owner: string;
    repo: string;
    number: number;
    title: string;
    draft: boolean;
    baseSha: string;
    headSha: string;
  };
  changedFiles: { total: number; paths: string[]; truncated: boolean };
  checks: { total: number; successful: number; failed: number; pending: number; skipped: number; names: string[] };
  reviews: { approved: number; changesRequested: number; commented: number; pending: number };
  riskSignals: Array<{
    code:
      | "draft_pull_request"
      | "no_check_runs"
      | "failed_check_runs"
      | "pending_check_runs"
      | "changes_requested"
      | "workflow_changed"
      | "dependency_changed"
      | "database_migration_changed"
      | "sensitive_path_changed";
    severity: "info" | "medium" | "high";
    paths?: string[];
  }>;
  collectedAt: string;
};

export class GitHubEvidenceError extends Error {
  constructor(public readonly code: "invalid_reference" | "github_unavailable" | "github_rejected", message: string) {
    super(message);
  }
}

const API_BASE = "https://api.github.com";

export function parseGitHubPullRequest(input: string): PullRequestRef {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new GitHubEvidenceError("invalid_reference", "A GitHub pull-request URL is required");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "github.com" || parts.length !== 4 || parts[2] !== "pull" || !/^\d+$/.test(parts[3])) {
    throw new GitHubEvidenceError("invalid_reference", "Expected https://github.com/{owner}/{repo}/pull/{number}");
  }
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]) };
}

type FetchLike = typeof fetch;

async function githubJson(fetchImpl: FetchLike, path: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new GitHubEvidenceError("github_unavailable", "GitHub could not be reached");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new GitHubEvidenceError("github_rejected", "GitHub rejected the read-only pull-request request");
  }
  if (!response.ok) throw new GitHubEvidenceError("github_unavailable", `GitHub request failed (${response.status})`);
  return response.json();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pathSignals(paths: string[]): GitHubEvidence["riskSignals"] {
  const match = (pattern: RegExp) => paths.filter((path) => pattern.test(path));
  const signals: GitHubEvidence["riskSignals"] = [];
  const workflows = match(/(^|\/)(\.github\/workflows\/|Dockerfile$|docker-compose\.)/i);
  const dependencies = match(/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|requirements[^/]*\.txt|go\.mod|Cargo\.lock)$/i);
  const migrations = match(/(^|\/)(migrations?|db\/migrate|schema\/changes)\//i);
  const sensitive = match(/(^|\/)(auth|permissions?|roles?|billing|payments?|security|secrets?)(\/|$)/i);
  if (workflows.length) signals.push({ code: "workflow_changed", severity: "high", paths: workflows });
  if (dependencies.length) signals.push({ code: "dependency_changed", severity: "medium", paths: dependencies });
  if (migrations.length) signals.push({ code: "database_migration_changed", severity: "high", paths: migrations });
  if (sensitive.length) signals.push({ code: "sensitive_path_changed", severity: "high", paths: sensitive });
  return signals;
}

/** Collect immutable-SHA evidence; this function performs read-only GitHub GET requests. */
export async function collectPullRequestEvidence(opts: {
  pullRequestUrl: string;
  token?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<GitHubEvidence> {
  const ref = parseGitHubPullRequest(opts.pullRequestUrl);
  const fetchImpl = opts.fetchImpl || fetch;
  const token = opts.token || "";
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const pull = record(await githubJson(fetchImpl, `${base}/pulls/${ref.number}`, token));
  const head = record(pull.head);
  const baseRef = record(pull.base);
  const headSha = string(head.sha);
  const baseSha = string(baseRef.sha);
  if (!headSha || !baseSha) throw new GitHubEvidenceError("github_unavailable", "GitHub returned a pull request without immutable commit SHAs");

  const [filesRaw, checksRaw, reviewsRaw] = await Promise.all([
    githubJson(fetchImpl, `${base}/pulls/${ref.number}/files?per_page=100`, token),
    githubJson(fetchImpl, `${base}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`, token),
    githubJson(fetchImpl, `${base}/pulls/${ref.number}/reviews?per_page=100`, token),
  ]);
  const files = Array.isArray(filesRaw) ? filesRaw.map(record) : [];
  const paths = files.map((file) => string(file.filename)).filter(Boolean);
  const checkRuns = Array.isArray(record(checksRaw).check_runs) ? record(checksRaw).check_runs as unknown[] : [];
  const reviews = Array.isArray(reviewsRaw) ? reviewsRaw.map(record) : [];

  const checks = { total: 0, successful: 0, failed: 0, pending: 0, skipped: 0, names: [] as string[] };
  for (const raw of checkRuns) {
    const run = record(raw);
    checks.total += 1;
    const name = string(run.name);
    if (name) checks.names.push(name);
    const conclusion = string(run.conclusion).toLowerCase();
    const status = string(run.status).toLowerCase();
    if (status !== "completed") checks.pending += 1;
    else if (["success", "neutral"].includes(conclusion)) checks.successful += 1;
    else if (["skipped", "cancelled"].includes(conclusion)) checks.skipped += 1;
    else checks.failed += 1;
  }
  const reviewSummary = { approved: 0, changesRequested: 0, commented: 0, pending: 0 };
  for (const review of reviews) {
    const state = string(review.state).toLowerCase();
    if (state === "approved") reviewSummary.approved += 1;
    else if (state === "changes_requested") reviewSummary.changesRequested += 1;
    else if (state === "commented") reviewSummary.commented += 1;
    else reviewSummary.pending += 1;
  }

  const riskSignals = pathSignals(paths);
  if (pull.draft === true) riskSignals.push({ code: "draft_pull_request", severity: "info" });
  if (!checks.total) riskSignals.push({ code: "no_check_runs", severity: "high" });
  if (checks.failed) riskSignals.push({ code: "failed_check_runs", severity: "high" });
  if (checks.pending) riskSignals.push({ code: "pending_check_runs", severity: "medium" });
  if (reviewSummary.changesRequested) riskSignals.push({ code: "changes_requested", severity: "high" });

  return {
    source: "github",
    pullRequest: {
      url: opts.pullRequestUrl,
      ...ref,
      title: string(pull.title),
      draft: pull.draft === true,
      baseSha,
      headSha,
    },
    changedFiles: { total: Number(pull.changed_files) || paths.length, paths, truncated: paths.length >= 100 },
    checks,
    reviews: reviewSummary,
    riskSignals,
    collectedAt: (opts.now || new Date()).toISOString(),
  };
}
