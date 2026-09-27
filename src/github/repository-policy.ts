import type { GitHubEvidence } from "./pr-evidence";

export type RepositoryPolicy = {
  repository: string;
  requiredCheckNames: string[];
  minimumApprovals: number;
  reviewPathPrefixes: string[];
};

export function parseRepositoryPolicy(raw: unknown, repository: string): RepositoryPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const value = (key: string) => Array.isArray(row[key]) ? row[key].map(String).map((item) => item.trim()).filter(Boolean) : [];
  const minimumApprovals = Number(row.minimumApprovals || 0);
  if (!Number.isInteger(minimumApprovals) || minimumApprovals < 0 || minimumApprovals > 10) return null;
  return {
    repository: repository.toLowerCase(),
    requiredCheckNames: value("requiredCheckNames"),
    minimumApprovals,
    reviewPathPrefixes: value("reviewPathPrefixes"),
  };
}

export function policyRequirements(evidence: GitHubEvidence, policy?: RepositoryPolicy | null): string[] {
  if (!policy) return [];
  const missingChecks = policy.requiredCheckNames.filter((name) => !evidence.checks.names.includes(name));
  const pathReview = policy.reviewPathPrefixes.filter((prefix) => evidence.changedFiles.paths.some((path) => path.startsWith(prefix)));
  const requirements: string[] = [];
  if (missingChecks.length) requirements.push(`Required GitHub checks are missing: ${missingChecks.join(", ")}`);
  if (evidence.reviews.approved < policy.minimumApprovals) requirements.push(`Repository policy requires ${policy.minimumApprovals} approval(s); found ${evidence.reviews.approved}`);
  if (pathReview.length) requirements.push(`Repository policy requires human review for changed path prefix: ${pathReview.join(", ")}`);
  return requirements;
}
