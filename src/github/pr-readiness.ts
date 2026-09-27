import type { GitHubEvidence } from "./pr-evidence";
import { policyRequirements, type RepositoryPolicy } from "./repository-policy";

export type PullRequestReadiness = {
  status: "ready" | "needs_action" | "blocked" | "human_review_required";
  gate: "pass" | "fail" | "unknown";
  reasons: string[];
  missingEvidence: string[];
  nextActions: Array<{ owner: "agent" | "human"; action: string }>;
  evidence: GitHubEvidence;
};

const HIGH_RISK_REVIEW_SIGNALS = new Set([
  "workflow_changed",
  "database_migration_changed",
  "sensitive_path_changed",
]);

/**
 * Deliberately conservative merge readiness. A passing CI signal never erases
 * a sensitive-change review requirement, and a missing or pending check can
 * never produce a pass gate.
 */
export function decidePullRequestReadiness(evidence: GitHubEvidence, policy?: RepositoryPolicy | null): PullRequestReadiness {
  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  const nextActions: PullRequestReadiness["nextActions"] = [];
  const codes = new Set(evidence.riskSignals.map((signal) => signal.code));

  if (evidence.checks.failed) {
    reasons.push(`${evidence.checks.failed} GitHub check run(s) failed`);
    nextActions.push({ owner: "agent", action: "Fix the failing check runs and collect fresh evidence for the new head SHA." });
  }
  if (evidence.reviews.changesRequested) {
    reasons.push("A reviewer requested changes");
    nextActions.push({ owner: "agent", action: "Address requested review changes, then collect fresh evidence for the new head SHA." });
  }
  if (reasons.length) {
    return { status: "blocked", gate: "fail", reasons, missingEvidence, nextActions, evidence };
  }

  if (evidence.pullRequest.draft) {
    reasons.push("Pull request is still marked as draft");
    nextActions.push({ owner: "human", action: "Mark the pull request ready for review only when its intended scope is complete." });
  }
  if (!evidence.checks.total) {
    missingEvidence.push("No GitHub check runs were found for the immutable head SHA");
    nextActions.push({ owner: "agent", action: "Run the required CI checks and collect fresh evidence for the same or a newer head SHA." });
  }
  if (evidence.checks.pending) {
    missingEvidence.push(`${evidence.checks.pending} GitHub check run(s) are still pending`);
    nextActions.push({ owner: "agent", action: "Wait for pending checks to finish, then collect fresh evidence for the head SHA." });
  }
  if (reasons.length || missingEvidence.length) {
    return { status: "needs_action", gate: "unknown", reasons, missingEvidence, nextActions, evidence };
  }

  const requirements = policyRequirements(evidence, policy);
  if (requirements.length) {
    reasons.push(...requirements);
    nextActions.push({ owner: "human", action: "Satisfy the repository policy requirements, then collect fresh evidence for the head SHA." });
    return { status: "human_review_required", gate: "unknown", reasons, missingEvidence, nextActions, evidence };
  }

  const reviewSignals = evidence.riskSignals.filter((signal) => HIGH_RISK_REVIEW_SIGNALS.has(signal.code));
  if (reviewSignals.length) {
    reasons.push(`Sensitive change requires human review: ${reviewSignals.map((signal) => signal.code).join(", ")}`);
    nextActions.push({ owner: "human", action: "Review the changed workflow, migration, or sensitive path against the intended release scope." });
    return { status: "human_review_required", gate: "unknown", reasons, missingEvidence, nextActions, evidence };
  }

  return {
    status: "ready",
    gate: "pass",
    reasons: ["All discovered GitHub check runs completed successfully and no high-risk path requires a human review."],
    missingEvidence,
    nextActions,
    evidence,
  };
}

/** Portable payload for the internal WorkRecord API; it contains no GitHub token. */
export function workRecordUpdateFromReadiness(opts: {
  workId: string;
  ownerKey: string;
  objective: string;
  readiness: PullRequestReadiness;
}): Record<string, unknown> {
  const { readiness } = opts;
  const status = readiness.status === "ready" ? "ready" : readiness.status === "blocked" ? "blocked" : "needs_action";
  return {
    workId: opts.workId,
    ownerKey: opts.ownerKey,
    objective: opts.objective,
    status,
    scope: {
      provider: "github",
      pullRequest: readiness.evidence.pullRequest,
    },
    latest: {
      kind: "github_pull_request_evidence",
      gate: readiness.gate,
      collectedAt: readiness.evidence.collectedAt,
      evidence: readiness.evidence,
    },
    handoff: {
      schemaVersion: "toolyour.handoff@1",
      state: readiness.status,
      nextOwner: readiness.nextActions[0]?.owner || "human",
      nextAction: readiness.nextActions[0]?.action || "No further action required.",
      reasons: readiness.reasons,
      missingEvidence: readiness.missingEvidence,
    },
  };
}
