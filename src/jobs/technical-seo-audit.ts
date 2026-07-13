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

export function synthesizeTechnicalSeoAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const seoReport = extractReport(stepResults.seo);
  const extractReportData = extractReport(stepResults.extract);
  const speedReport = extractReport(stepResults.speed);

  const seoFindings = findingsFromReport(seoReport, "technicalSeo");
  const linkFindings = findingsFromReport(extractReportData, "linkProfile");
  const speedFindings = findingsFromReport(speedReport, "performance");
  const findings = mergeFindings(seoFindings, linkFindings, speedFindings);

  const seoScore =
    typeof seoReport?.summary === "object"
      ? (seoReport.summary as Record<string, unknown>).totalScore
      : unwrapToolPayload(stepResults.seo)?.overallScore;
  const linkScore =
    typeof extractReportData?.summary === "object"
      ? (extractReportData.summary as Record<string, unknown>).totalScore
      : undefined;
  const speedScore =
    typeof speedReport?.summary === "object"
      ? (speedReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const numeric = [seoScore, linkScore, speedScore].filter((s): s is number => typeof s === "number");
  const overall =
    numeric.length > 0 ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length) : undefined;

  const proxies =
    speedReport?.metrics && typeof speedReport.metrics === "object"
      ? ((speedReport.metrics as Record<string, unknown>).proxies as Record<string, unknown>)
      : {};

  const scores: JobReport["scores"] = {
    overall: {
      label: "Technical SEO health (lite)",
      value: overall ?? "—",
      status: scoreFromProxy(overall),
    },
    technicalSeo: {
      label: "On-page technical SEO",
      value: typeof seoScore === "number" ? seoScore : "—",
      status: scoreFromProxy(seoScore),
    },
    linkProfile: {
      label: "Page link profile",
      value: typeof linkScore === "number" ? linkScore : "—",
      status: scoreFromProxy(linkScore),
    },
    performance: {
      label: "Page speed proxy",
      value: typeof speedScore === "number" ? speedScore : "—",
      status: scoreFromProxy(speedScore),
    },
    LCP: {
      label: "LCP proxy",
      value: typeof proxies.lcpScore === "number" ? `${proxies.lcpScore}/100` : "—",
      status: scoreFromProxy(proxies.lcpScore),
    },
  };

  const prioritizedActions = rankActions(findings);
  const summary = [
    url ? `Technical SEO audit (lite) for ${url}.` : "Technical SEO audit complete.",
    `${findings.filter((f) => f.severity === "high").length} high-severity technical issues flagged.`,
    prioritizedActions[0]
      ? `Top fix: ${prioritizedActions[0].action}`
      : "No critical technical blockers in this pass.",
    "For full optimization (content + site links + social), use full-seo-optimization.",
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
      technicalSeo: { report: seoReport },
      linkProfile: { report: extractReportData },
      performance: { report: speedReport },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Lite audit — single-page link extract only (no site-wide crawl).",
      "Speed metrics are HTML proxies, not field CrUX data.",
    ],
  };
}
