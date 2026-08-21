import type { JobReport, SynthesizeJobParams } from "./types";
import {
  assetActionsFromSpeedReport,
  extractAssetOptimizer,
  extractReport,
  extractUrl,
  findingsFromReport,
  mergeFindings,
  mergePrioritizedActions,
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
  const assetOptimizer = extractAssetOptimizer(speedReport);

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

  const speedWeak =
    typeof speedScore === "number"
      ? speedScore < 80
      : scoreFromProxy(proxies.lcpScore) !== "good" ||
        scoreFromProxy(proxies.clsScore) !== "good";

  const seoMissing = !seoReport && !seoPayload;
  const highCount = findings.filter((f) => f.severity === "high").length;

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

  const seoActions = rankActions(seoFindings, 10);
  const speedFindingActions = rankActions(speedFindings, 6);
  const assetActions = speedWeak ? assetActionsFromSpeedReport(speedReport, 3) : [];
  const prioritizedActions = mergePrioritizedActions(
    seoActions,
    assetActions,
    speedFindingActions
  ).slice(0, 12);

  const summary = [
    url
      ? `Audited ${url} with on-page SEO and page speed proxies.`
      : "Completed on-page SEO and page speed audit.",
    seoMissing || scores.technicalSeo.status === "unknown"
      ? "On-page SEO score unavailable — do not treat this as a clean SEO pass."
      : highCount
        ? `${highCount} high-severity issues need attention first.`
        : findings.length
          ? `${findings.length} finding(s) remain — review prioritized actions.`
          : "No findings in scored workstreams for this pass.",
    assetActions[0]
      ? `Speed asset priority: ${assetActions[0].action}`
      : prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Review step details for optimization opportunities.",
  ];

  const report: JobReport = {
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
      assets: assetOptimizer
        ? { assetOptimizer, includedBecauseSpeedWeak: speedWeak }
        : { assetOptimizer: null },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Speed metrics are HTML-based proxies, not Chrome UX Report field data.",
      "Run page-performance (core-web-vitals-job) for a deeper CWV-focused diagnosis.",
      "Asset optimizer hints come from pageSpeedAnalyzer evidence when speed proxies are weak.",
      "Gate fails when on-page SEO score is unknown — re-run after the SEO step succeeds.",
    ],
  };

  if (seoMissing || scores.technicalSeo.status === "unknown") {
    return {
      ...report,
      incomplete: true,
      summary: [
        "INCOMPLETE: On-page SEO step did not produce a score. Do not treat as gate pass.",
        ...report.summary.filter((s) => !/^INCOMPLETE:/i.test(s)),
      ],
    };
  }

  return report;
}
