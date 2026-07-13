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

export function synthesizeFullSeoAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const seoShaped = stepResults.seo;
  const speedShaped = stepResults.speed;

  const seoReport = extractReport(seoShaped);
  const speedReport = extractReport(speedShaped);
  const seoPayload = unwrapToolPayload(seoShaped);
  const speedPayload = unwrapToolPayload(speedShaped);

  const seoFindings = findingsFromReport(seoReport, "technicalSeo");
  const speedFindings = findingsFromReport(speedReport, "performance");
  const findings = mergeFindings(seoFindings, speedFindings);

  const overallSeo =
    typeof seoReport?.summary === "object"
      ? (seoReport.summary as Record<string, unknown>).totalScore
      : seoPayload?.overallScore;
  const speedScore =
    typeof speedReport?.summary === "object"
      ? (speedReport.summary as Record<string, unknown>).totalScore
      : undefined;
  const proxies =
    speedReport?.metrics && typeof speedReport.metrics === "object"
      ? ((speedReport.metrics as Record<string, unknown>).proxies as Record<string, unknown>)
      : {};

  const scores: JobReport["scores"] = {
    overall: {
      label: "Combined SEO + speed proxy",
      value:
        typeof overallSeo === "number" && typeof speedScore === "number"
          ? Math.round((overallSeo + speedScore) / 2)
          : typeof overallSeo === "number"
            ? overallSeo
            : typeof speedScore === "number"
              ? speedScore
              : "—",
      status:
        typeof overallSeo === "number"
          ? scoreFromProxy(overallSeo)
          : typeof speedScore === "number"
            ? scoreFromProxy(speedScore)
            : "unknown",
    },
    technicalSeo: {
      label: "On-page SEO",
      value: typeof overallSeo === "number" ? overallSeo : "—",
      status: scoreFromProxy(overallSeo),
    },
    performance: {
      label: "Page speed proxy",
      value: typeof speedScore === "number" ? speedScore : "—",
      status: scoreFromProxy(speedScore),
    },
    LCP: {
      label: "LCP proxy score",
      value: typeof proxies.lcpScore === "number" ? proxies.lcpScore : "—",
      status: scoreFromProxy(proxies.lcpScore),
      primaryCause: speedFindings.find((f) => /lcp/i.test(f.title))?.title,
    },
    CLS: {
      label: "CLS proxy score",
      value: typeof proxies.clsScore === "number" ? proxies.clsScore : "—",
      status: scoreFromProxy(proxies.clsScore),
    },
  };

  const prioritizedActions = rankActions(findings);
  const summary = [
    url ? `Audited ${url} with on-page SEO and page speed proxies.` : "Completed on-page SEO and page speed audit.",
    findings.length
      ? `${findings.filter((f) => f.severity === "high").length} high-severity issues need attention first.`
      : "No high-severity issues detected in this pass.",
    prioritizedActions[0]
      ? `Top fix: ${prioritizedActions[0].action}`
      : "Review step details for optimization opportunities.",
  ];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary,
    scores,
    findings,
    prioritizedActions,
    workstreams: {
      technicalSeo: { report: seoReport, data: seoPayload },
      performance: { report: speedReport, data: speedPayload },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Speed metrics are HTML-based proxies, not Chrome UX Report field data.",
      "Run improve-core-web-vitals for a deeper CWV-focused diagnosis.",
    ],
  };
}
