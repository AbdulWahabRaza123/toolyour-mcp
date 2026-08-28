import type { JobFinding, JobReport } from "../jobs/types";
import type { VerifyDelta } from "../orchestrator/verify-task";
import type { RemainingFix } from "../orchestrator/job-report";

export interface VerificationEvidence {
  id: string;
  findingId?: string;
  check?: string;
  severity: string;
  title: string;
  metric?: string;
  value?: string | number;
  threshold?: string;
  status: "passed" | "failed" | "warn" | "info";
  acceptance?: string;
  url?: string;
  runId?: string;
  timestamp: string;
  comparison?: {
    baselineRunId?: string | null;
    previous?: string | number;
    change?: "improved" | "regressed" | "unchanged" | "new" | "resolved";
  };
}

function evidenceStatus(severity: string): VerificationEvidence["status"] {
  const s = severity.toLowerCase();
  if (s === "high" || s === "fail" || s === "poor") return "failed";
  if (s === "medium" || s === "warn" || s === "needs_improvement") return "warn";
  if (s === "pass" || s === "low" || s === "good") return "passed";
  return "info";
}

function evidenceFromFinding(
  f: JobFinding,
  idx: number,
  opts: { url?: string; runId?: string }
): VerificationEvidence {
  const findingId = f.findingId || `finding_${idx}`;
  return {
    id: `ev_${findingId}`,
    findingId,
    check: f.workstream,
    severity: f.severity,
    title: f.title,
    metric: f.metric,
    status: evidenceStatus(f.severity),
    acceptance:
      Array.isArray(f.howToFix) && f.howToFix[0]
        ? String(f.howToFix[0])
        : f.whyItMatters,
    url: opts.url,
    runId: opts.runId,
    timestamp: new Date().toISOString(),
  };
}

function evidenceFromScores(report: JobReport | null, url?: string, runId?: string): VerificationEvidence[] {
  if (!report?.scores) return [];
  const out: VerificationEvidence[] = [];
  for (const [key, score] of Object.entries(report.scores)) {
    const status =
      score.status === "good"
        ? "passed"
        : score.status === "needs_improvement"
          ? "warn"
          : score.status === "poor"
            ? "failed"
            : "info";
    out.push({
      id: `ev_score_${key}`,
      check: key,
      severity: score.status,
      title: score.label || key,
      metric: key,
      value: score.value,
      status,
      acceptance: score.primaryCause,
      url,
      runId,
      timestamp: new Date().toISOString(),
    });
  }
  return out;
}

export function buildEvidencePack(opts: {
  report: JobReport | null;
  remainingFixes?: RemainingFix[];
  delta?: VerifyDelta | null;
  url?: string;
  runId?: string;
  baselineRunId?: string | null;
  maxItems?: number;
}): VerificationEvidence[] {
  const max = opts.maxItems ?? 12;
  const url = opts.url || opts.report?.url;
  const findings = (opts.report?.findings || []).slice(0, max);
  const fromFindings = findings.map((f, i) =>
    evidenceFromFinding(f, i, { url, runId: opts.runId })
  );

  const rank1 = opts.remainingFixes?.[0];
  if (rank1 && !fromFindings.some((e) => e.findingId === rank1.findingId)) {
    fromFindings.unshift({
      id: `ev_rank1_${rank1.findingId || "fix"}`,
      findingId: rank1.findingId,
      check: rank1.workstream,
      severity: rank1.severity || "high",
      title: rank1.title,
      status: "failed",
      acceptance: rank1.acceptance,
      url,
      runId: opts.runId,
      timestamp: new Date().toISOString(),
    });
  }

  const scores = evidenceFromScores(opts.report, url, opts.runId).filter(
    (s) => s.status === "failed" || s.status === "warn"
  );

  const merged = [...fromFindings, ...scores].slice(0, max);

  if (opts.delta?.scoreDeltas?.[0]) {
    const sd = opts.delta.scoreDeltas[0];
    const target = merged.find((e) => e.metric === sd.key);
    if (target) {
      target.comparison = {
        baselineRunId: opts.baselineRunId,
        previous: sd.before,
        change:
          opts.delta.status === "regressed"
            ? "regressed"
            : opts.delta.status === "improved"
              ? "improved"
              : "unchanged",
      };
    }
  }

  return merged;
}

export function buildRegressionAlert(opts: {
  delta?: VerifyDelta | null;
  profileLastPassAt?: string | null;
  profileLastPassGate?: string | null;
}): string | undefined {
  if (!opts.delta) return undefined;
  if (opts.delta.status === "regressed") {
    const headline = opts.delta.summary?.[0] || "Verification regressed vs baseline.";
    if (opts.profileLastPassAt && opts.profileLastPassGate === "pass") {
      return `${headline} Last verified pass was ${opts.profileLastPassAt}.`;
    }
    return headline;
  }
  if (opts.delta.status === "improved" && opts.profileLastPassGate === "pass") {
    return "Improved vs prior run — continue until loop.gate is pass.";
  }
  return undefined;
}
