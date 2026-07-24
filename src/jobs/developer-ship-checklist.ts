import type { JobReport, SynthesizeJobParams } from "./types";
import {
  extractReport,
  extractUrl,
  findingsFromReport,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";
import { findingsFromSecurityPayload } from "./full-security-audit";

/**
 * Pre-deploy ship gate: security headers + TLS + mixed content + HTTP status + speed.
 */
export function synthesizeDeveloperShipChecklist(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const headers = unwrapToolPayload(stepResults.headers);
  const tls = unwrapToolPayload(stepResults.tls);
  const mixedReport = extractReport(stepResults.mixed);
  const statusReport = extractReport(stepResults.status);
  const speedReport = extractReport(stepResults.speed);
  const mixedPayload = unwrapToolPayload(stepResults.mixed);
  const statusPayload = unwrapToolPayload(stepResults.status);
  const speedPayload = unwrapToolPayload(stepResults.speed);

  const findings = mergeFindings(
    findingsFromSecurityPayload(headers, "securityHeaders"),
    findingsFromSecurityPayload(tls, "tls"),
    findingsFromReport(mixedReport, "mixedContent"),
    findingsFromReport(statusReport, "httpStatus"),
    findingsFromReport(speedReport, "performance")
  );

  const headerScore =
    typeof headers?.score === "number" ? headers.score : undefined;
  const mixedScore =
    typeof mixedReport?.summary === "object"
      ? (mixedReport.summary as Record<string, unknown>).totalScore
      : undefined;
  const statusScore =
    typeof statusReport?.summary === "object"
      ? (statusReport.summary as Record<string, unknown>).totalScore
      : undefined;
  const speedScore =
    typeof speedReport?.summary === "object"
      ? (speedReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const tlsSeverity = String(tls?.severity ?? "");
  const numeric = [headerScore, mixedScore, statusScore, speedScore].filter(
    (s): s is number => typeof s === "number"
  );
  const overall =
    numeric.length > 0
      ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length)
      : undefined;

  const prioritizedActions = rankActions(findings, 14);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Developer ship checklist for ${url} (security + mixed content + status + speed).`
        : "Developer ship checklist complete.",
      high
        ? `${high} high-severity blockers — fix before production.`
        : "No high-severity blockers in this pass.",
      prioritizedActions[0]
        ? `Top action: ${prioritizedActions[0].action}`
        : "Ready for a human smoke test.",
    ],
    scores: {
      overall: {
        label: "Ship readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      securityHeaders: {
        label: "Security headers",
        value: typeof headerScore === "number" ? headerScore : "—",
        status: scoreFromProxy(headerScore),
      },
      tls: {
        label: "TLS certificate",
        value:
          typeof tls?.daysRemaining === "number"
            ? `${tls.daysRemaining}d remaining`
            : tlsSeverity || "—",
        status:
          tlsSeverity === "fail"
            ? "poor"
            : tlsSeverity === "warn"
              ? "needs_improvement"
              : tlsSeverity === "pass"
                ? "good"
                : "unknown",
      },
      mixedContent: {
        label: "Mixed content",
        value: typeof mixedScore === "number" ? mixedScore : "—",
        status: scoreFromProxy(mixedScore),
      },
      httpStatus: {
        label: "HTTP status",
        value: typeof statusScore === "number" ? statusScore : "—",
        status: scoreFromProxy(statusScore),
      },
      performance: {
        label: "Page speed proxy",
        value: typeof speedScore === "number" ? speedScore : "—",
        status: scoreFromProxy(speedScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      securityHeaders: { data: headers },
      tls: { data: tls },
      mixedContent: { report: mixedReport, data: mixedPayload },
      httpStatus: { report: statusReport, data: statusPayload },
      performance: { report: speedReport, data: speedPayload },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Ship checklist is a smoke gate — not a full penetration test or accessibility audit.",
      "Speed metrics are HTML-based proxies, not CrUX field data.",
      "For staging vs prod template diffs, run seo-deploy-regression-diff separately.",
    ],
  };
}
