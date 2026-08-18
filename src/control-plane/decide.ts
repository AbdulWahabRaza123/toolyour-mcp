import type {
  CheckResult,
  DecideResult,
  Decision,
  DecisionEvidence,
  DecisionStatus,
  Job,
  NextAction,
  RuleId,
} from "./types";

function resultMap(results: CheckResult[]): Map<string, CheckResult> {
  return new Map(results.map((r) => [r.checkId, r]));
}

function remainingRequirements(job: Job, results: CheckResult[]): string[] {
  const byId = resultMap(results);
  return job.spec.acceptance
    .filter((ac) => {
      if (!ac.requiredCheckIds.length) return true;
      return !ac.requiredCheckIds.every((id) => byId.get(id)?.status === "pass");
    })
    .map((ac) => ac.id);
}

function allRequiredPass(job: Job, results: CheckResult[]): boolean {
  const byId = resultMap(results);
  return job.spec.requiredCheckIds.every((id) => byId.get(id)?.status === "pass");
}

function evidenceFrom(
  iteration: number,
  gitSha: string | undefined,
  results: CheckResult[],
  treeHash?: string
): DecisionEvidence {
  return {
    iteration,
    gitSha,
    treeHash,
    fingerprints: results.map((r) => ({
      checkId: r.checkId,
      fingerprint: r.fingerprint,
      status: r.status,
    })),
  };
}

function nextAction(job: Job, results: CheckResult[]): NextAction | null {
  const byId = resultMap(results);
  for (const check of job.spec.checks) {
    if (!job.spec.requiredCheckIds.includes(check.id)) continue;
    const r = byId.get(check.id);
    if (r && (r.status === "fail" || r.status === "error")) {
      const summary = String(r.summary || "").slice(0, 500);
      const testNames = summary
        .split(" — ")[0]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      const snippet = summary.includes(" — ") ? summary.split(" — ").slice(1).join(" — ").slice(0, 400) : "";
      return {
        type: "fix",
        targetCheckId: check.id,
        label: `Fix ${check.id}: ${summary || check.command}`,
        testNames,
        snippet,
      };
    }
  }
  return null;
}

function makeDecision(
  job: Job,
  submission: CheckResult[],
  status: DecisionStatus,
  ruleId: RuleId,
  reason: string,
  iterationN: number,
  gitSha?: string,
  treeHash?: string
): Decision {
  const terminal = status !== "continue";
  return {
    status,
    next_action: terminal ? null : nextAction(job, submission),
    reason,
    ruleId,
    requires_human: status === "escalated" || status === "cancelled",
    remaining_requirements: remainingRequirements(job, submission),
    evidence: evidenceFrom(iterationN, gitSha, submission, treeHash),
  };
}

function countFailFingerprint(
  job: Job,
  submission: CheckResult[],
  checkId: string,
  fingerprint: string
): number {
  let n = 0;
  for (const iter of job.iterations) {
    const r = iter.results.find((x) => x.checkId === checkId);
    if (r && r.status === "fail" && r.fingerprint === fingerprint) n += 1;
  }
  const cur = submission.find((x) => x.checkId === checkId);
  if (cur && cur.status === "fail" && cur.fingerprint === fingerprint) n += 1;
  return n;
}

/**
 * Pure decision engine. First match wins.
 * R8: same worktree hash while still failing, repeatFailN times (no-progress).
 * R4 is a hard cap: evaluated before R2/R5 so errors/fails at maxIterations escalate.
 */
export function decide(
  job: Job,
  submission: CheckResult[],
  gitSha?: string,
  treeHash?: string
): DecideResult {
  const iterationN = job.iterations.length + 1;

  if (job.state === "cancelled") {
    return {
      ok: true,
      decision: makeDecision(
        job,
        submission,
        "cancelled",
        "R0",
        "Job is cancelled.",
        Math.max(job.iteration, 0),
        gitSha,
        treeHash
      ),
    };
  }

  const missing = job.spec.requiredCheckIds.filter(
    (id) => !submission.some((r) => r.checkId === id)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      ruleId: "R1",
      error: {
        code: "check_required_missing",
        message: `Missing required checks: ${missing.join(", ")}`,
      },
    };
  }

  const byId = resultMap(submission);
  const passed = allRequiredPass(job, submission);

  if (treeHash && !passed) {
    const sameTree =
      1 + job.iterations.filter((iter) => iter.treeHash && iter.treeHash === treeHash).length;
    if (sameTree >= job.spec.repeatFailN) {
      return {
        ok: true,
        decision: makeDecision(
          job,
          submission,
          "escalated",
          "R8",
          `No file progress after ${sameTree} submissions (same treeHash).`,
          iterationN,
          gitSha,
          treeHash
        ),
      };
    }
  }

  for (const checkId of job.spec.requiredCheckIds) {
    const cur = byId.get(checkId);
    if (!cur || cur.status !== "fail") continue;
    const count = countFailFingerprint(
      job,
      submission,
      checkId,
      cur.fingerprint
    );
    if (count >= job.spec.repeatFailN) {
      return {
        ok: true,
        decision: makeDecision(
          job,
          submission,
          "escalated",
          "R3",
          `Repeated failure on ${checkId} (${count}× fingerprint).`,
          iterationN,
          gitSha,
          treeHash
        ),
      };
    }
  }

  if (iterationN >= job.spec.maxIterations && !passed) {
    return {
      ok: true,
      decision: makeDecision(
        job,
        submission,
        "escalated",
        "R4",
        `No pass after ${iterationN} iteration(s) (max ${job.spec.maxIterations}).`,
        iterationN,
        gitSha,
        treeHash
      ),
    };
  }

  if (job.spec.requiredCheckIds.some((id) => byId.get(id)?.status === "error")) {
    return {
      ok: true,
      decision: makeDecision(
        job,
        submission,
        "continue",
        "R2",
        "A required check returned status=error.",
        iterationN,
        gitSha,
        treeHash
      ),
    };
  }

  if (job.spec.requiredCheckIds.some((id) => byId.get(id)?.status === "fail")) {
    return {
      ok: true,
      decision: makeDecision(
        job,
        submission,
        "continue",
        "R5",
        "A required check failed.",
        iterationN,
        gitSha,
        treeHash
      ),
    };
  }

  const emptyAc = job.spec.acceptance.find((ac) => ac.requiredCheckIds.length === 0);
  if (emptyAc) {
    return {
      ok: true,
      decision: makeDecision(
        job,
        submission,
        "escalated",
        "R7",
        `Acceptance criterion ${emptyAc.id} has an empty check mapping.`,
        iterationN,
        gitSha,
        treeHash
      ),
    };
  }

  return {
    ok: true,
    decision: makeDecision(
      job,
      submission,
      "verified",
      "R6",
      "All required checks passed and every acceptance criterion is mapped.",
      iterationN,
      gitSha,
      treeHash
    ),
  };
}

export function cancelledDecision(job: Job): Decision {
  return makeDecision(
    job,
    job.iterations[job.iterations.length - 1]?.results || [],
    "cancelled",
    "R0",
    "Job cancelled by owner.",
    job.iteration,
    job.iterations[job.iterations.length - 1]?.gitSha
  );
}
