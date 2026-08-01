import type { JobFinding, JobReport } from "../jobs/types";

export interface VerifyDelta {
  status: "improved" | "regressed" | "unchanged" | "unknown";
  scoreDeltas: Array<{
    key: string;
    before: string | number;
    after: string | number;
  }>;
  newFindings: JobFinding[];
  resolvedFindings: JobFinding[];
  summary: string[];
}

function scoreMap(report: JobReport | null | undefined): Record<string, string | number> {
  if (!report?.scores) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(report.scores)) {
    out[k] = v.value;
  }
  return out;
}

function findingKey(f: JobFinding): string {
  return `${f.workstream || ""}|${f.title}`.toLowerCase();
}

export function extractJobReport(payload: unknown): JobReport | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.schemaVersion === "toolyour.jobReport@1") {
    return root as unknown as JobReport;
  }
  if (root.jobReport && typeof root.jobReport === "object") {
    return root.jobReport as JobReport;
  }
  if (
    root.execution &&
    typeof root.execution === "object" &&
    (root.execution as Record<string, unknown>).jobReport
  ) {
    return (root.execution as Record<string, unknown>).jobReport as JobReport;
  }
  return null;
}

/**
 * Compare baseline jobReport to a fresh run — agent-facing delta only.
 */
export function diffJobReports(
  before: JobReport | null,
  after: JobReport | null
): VerifyDelta {
  if (!before || !after) {
    return {
      status: "unknown",
      scoreDeltas: [],
      newFindings: after?.findings || [],
      resolvedFindings: [],
      summary: [
        "Could not compare — provide baseline.jobReport (or previous solve_task result) and a fresh run.",
      ],
    };
  }

  const beforeScores = scoreMap(before);
  const afterScores = scoreMap(after);
  const keys = new Set([...Object.keys(beforeScores), ...Object.keys(afterScores)]);
  const scoreDeltas: VerifyDelta["scoreDeltas"] = [];
  let improved = 0;
  let regressed = 0;

  for (const key of keys) {
    const b = beforeScores[key];
    const a = afterScores[key];
    if (b === undefined || a === undefined) continue;
    if (b === a) continue;
    scoreDeltas.push({ key, before: b, after: a });
    if (typeof b === "number" && typeof a === "number") {
      if (a > b) improved++;
      else if (a < b) regressed++;
    }
  }

  const beforeKeys = new Set((before.findings || []).map(findingKey));
  const afterKeys = new Set((after.findings || []).map(findingKey));
  const newFindings = (after.findings || []).filter(
    (f) => !beforeKeys.has(findingKey(f))
  );
  const resolvedFindings = (before.findings || []).filter(
    (f) => !afterKeys.has(findingKey(f))
  );

  if (regressed > improved || newFindings.length > resolvedFindings.length) {
    return {
      status: "regressed",
      scoreDeltas,
      newFindings,
      resolvedFindings,
      summary: [
        `Regression: ${newFindings.length} new finding(s), ${resolvedFindings.length} resolved.`,
        scoreDeltas[0]
          ? `Score move: ${scoreDeltas[0].key} ${scoreDeltas[0].before} → ${scoreDeltas[0].after}`
          : "Review new findings before shipping.",
      ],
    };
  }

  if (improved > 0 || resolvedFindings.length > 0) {
    return {
      status: "improved",
      scoreDeltas,
      newFindings,
      resolvedFindings,
      summary: [
        `Improved: ${resolvedFindings.length} finding(s) resolved, ${newFindings.length} new.`,
        scoreDeltas[0]
          ? `Score move: ${scoreDeltas[0].key} ${scoreDeltas[0].before} → ${scoreDeltas[0].after}`
          : "Scores stable or better.",
      ],
    };
  }

  return {
    status: "unchanged",
    scoreDeltas,
    newFindings,
    resolvedFindings,
    summary: ["No material score or finding changes vs baseline."],
  };
}
