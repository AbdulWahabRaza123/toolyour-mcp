/**
 * Universal + domain-aware evaluation dimensions for feature memory.
 */
import type { JobReport } from "../jobs/types";
import { computeVerifyGate } from "./job-report";

export type MatrixDimensionStatus = "good" | "needs_improvement" | "poor" | "unknown";

export type EvaluationDimension = {
  label: string;
  score: number;
  status: MatrixDimensionStatus;
  notes?: string;
};

export type FeatureEvaluationMatrix = Record<string, EvaluationDimension>;

export const UNIVERSAL_DIMENSIONS: Array<{ key: string; label: string; weight: number }> = [
  { key: "correctness", label: "Correctness", weight: 1.2 },
  { key: "completeness", label: "Requirement coverage", weight: 1.0 },
  { key: "reliability", label: "Reliability", weight: 1.0 },
  { key: "performance", label: "Performance", weight: 0.9 },
  { key: "efficiency", label: "Cost / efficiency", weight: 0.8 },
  { key: "security", label: "Security", weight: 1.0 },
  { key: "maintainability", label: "Maintainability", weight: 0.7 },
  { key: "observability", label: "Observability", weight: 0.6 },
  { key: "ux", label: "UX / DX", weight: 0.7 },
  { key: "regressionRisk", label: "Regression safety", weight: 0.9 },
];

const STATUS_SCORE: Record<MatrixDimensionStatus, number> = {
  good: 90,
  needs_improvement: 65,
  poor: 35,
  unknown: 50,
};

function scoreFromStatus(status: MatrixDimensionStatus): number {
  return STATUS_SCORE[status] ?? 50;
}

function statusFromScore(score: number): MatrixDimensionStatus {
  if (score >= 80) return "good";
  if (score >= 55) return "needs_improvement";
  if (score > 0) return "poor";
  return "unknown";
}

export function computeCompositeScore(matrix: FeatureEvaluationMatrix): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const dim of UNIVERSAL_DIMENSIONS) {
    const entry = matrix[dim.key];
    if (!entry) continue;
    weighted += entry.score * dim.weight;
    totalWeight += dim.weight;
  }
  if (!totalWeight) return 0;
  return Math.round(weighted / totalWeight);
}

export function buildMatrixFromJobReport(
  report: JobReport | null,
  opts?: { gate?: string; incomplete?: boolean }
): FeatureEvaluationMatrix {
  const gate = opts?.gate || (report ? computeVerifyGate(report) : "unknown");
  const highFindings = (report?.findings || []).filter(
    (f) => String(f.severity).toLowerCase() === "high"
  ).length;
  const poorScores = Object.values(report?.scores || {}).filter(
    (s) => s.status === "poor"
  ).length;
  const needsScores = Object.values(report?.scores || {}).filter(
    (s) => s.status === "needs_improvement"
  ).length;

  const correctness: MatrixDimensionStatus =
    gate === "pass" ? "good" : highFindings > 0 ? "poor" : "needs_improvement";
  const completeness: MatrixDimensionStatus = report?.incomplete
    ? "needs_improvement"
    : gate === "pass"
      ? "good"
      : "unknown";
  const reliability: MatrixDimensionStatus =
    poorScores > 1 ? "poor" : poorScores === 1 ? "needs_improvement" : "good";
  const performance: MatrixDimensionStatus =
    report?.scores?.performance?.status === "poor"
      ? "poor"
      : report?.scores?.performance?.status === "needs_improvement"
        ? "needs_improvement"
        : report?.scores?.performance
          ? "good"
          : "unknown";
  const security: MatrixDimensionStatus =
    report?.scores?.securityHeaders?.status === "poor" ||
    highFindings > 0
      ? "needs_improvement"
      : gate === "pass"
        ? "good"
        : "unknown";

  const mk = (status: MatrixDimensionStatus, label: string, notes?: string) => ({
    label,
    score: scoreFromStatus(status),
    status,
    notes,
  });

  return {
    correctness: mk(correctness, "Correctness", `gate=${gate}, highFindings=${highFindings}`),
    completeness: mk(completeness, "Requirement coverage"),
    reliability: mk(reliability, "Reliability", `poorScores=${poorScores}`),
    performance: mk(performance, "Performance"),
    efficiency: mk(
      needsScores > 2 ? "needs_improvement" : "good",
      "Cost / efficiency"
    ),
    security: mk(security, "Security"),
    maintainability: mk("unknown", "Maintainability"),
    observability: mk("unknown", "Observability"),
    ux: mk(gate === "pass" ? "good" : "needs_improvement", "UX / DX"),
    regressionRisk: mk(
      gate === "pass" ? "good" : "needs_improvement",
      "Regression safety"
    ),
  };
}

export type MatrixComparison = {
  status: "improved" | "regressed" | "unchanged" | "mixed";
  compositeDelta: number;
  dimensionDeltas: Array<{
    key: string;
    label: string;
    before: number;
    after: number;
    change: "improved" | "regressed" | "unchanged";
  }>;
  summary: string[];
};

export function compareEvaluationMatrices(
  before: FeatureEvaluationMatrix,
  after: FeatureEvaluationMatrix
): MatrixComparison {
  const dimensionDeltas: MatrixComparison["dimensionDeltas"] = [];
  let improved = 0;
  let regressed = 0;

  for (const dim of UNIVERSAL_DIMENSIONS) {
    const b = before[dim.key]?.score ?? 0;
    const a = after[dim.key]?.score ?? 0;
    if (b === a) continue;
    const change = a > b ? "improved" : "regressed";
    if (change === "improved") improved += 1;
    else regressed += 1;
    dimensionDeltas.push({
      key: dim.key,
      label: before[dim.key]?.label || dim.label,
      before: b,
      after: a,
      change,
    });
  }

  const beforeComposite = computeCompositeScore(before);
  const afterComposite = computeCompositeScore(after);
  const compositeDelta = afterComposite - beforeComposite;

  let status: MatrixComparison["status"] = "unchanged";
  if (improved > regressed) status = "improved";
  else if (regressed > improved) status = "regressed";
  else if (improved && regressed) status = "mixed";

  const summary: string[] = [];
  if (compositeDelta > 0) {
    summary.push(`Composite score improved ${beforeComposite} → ${afterComposite}.`);
  } else if (compositeDelta < 0) {
    summary.push(`Composite score regressed ${beforeComposite} → ${afterComposite}.`);
  } else {
    summary.push("Composite score unchanged.");
  }

  return { status, compositeDelta, dimensionDeltas, summary };
}

export function matrixToCapabilityGaps(
  matrix: FeatureEvaluationMatrix,
  max = 6
): Array<{ id: string; label: string; status: string; acceptance?: string }> {
  return Object.entries(matrix)
    .filter(([, v]) => v.status === "poor" || v.status === "needs_improvement")
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, max)
    .map(([key, v]) => ({
      id: key,
      label: v.label,
      status: v.status,
      acceptance: v.notes || `Improve ${v.label} (target score ≥ 80)`,
    }));
}

export { statusFromScore };
