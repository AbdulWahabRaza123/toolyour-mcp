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

function inferMetricFromTitle(title: string): string | undefined {
  if (/lcp|largest contentful/i.test(title)) return "LCP";
  if (/cls|layout shift/i.test(title)) return "CLS";
  if (/tbt|blocking|inp|interaction/i.test(title)) return "INP";
  if (/ttfb|time to first byte|server/i.test(title)) return "TTFB";
  if (/fcp|first contentful/i.test(title)) return "FCP";
  return undefined;
}

export function synthesizeCoreWebVitals(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const speedShaped = stepResults.speed;
  const seoShaped = stepResults.seo;
  const socialShaped = stepResults.social;

  const speedReport = extractReport(speedShaped);
  const seoReport = extractReport(seoShaped);
  const socialReport = extractReport(socialShaped);
  const speedPayload = unwrapToolPayload(speedShaped);
  const assetOptimizer = extractAssetOptimizer(speedReport);

  const speedFindings = findingsFromReport(speedReport, "performance").map((f) => ({
    ...f,
    metric: f.metric || inferMetricFromTitle(f.title),
  }));
  const seoFindings = findingsFromReport(seoReport, "technicalSeo");
  const socialFindings = findingsFromReport(socialReport, "socialPreview");
  const findings = mergeFindings(speedFindings, seoFindings, socialFindings);

  const proxies =
    speedReport?.metrics && typeof speedReport.metrics === "object"
      ? ((speedReport.metrics as Record<string, unknown>).proxies as Record<string, unknown>)
      : {};
  const metrics =
    speedReport?.metrics && typeof speedReport.metrics === "object"
      ? (speedReport.metrics as Record<string, unknown>)
      : {};
  const ttfbMs =
    typeof metrics.ttfbMs === "number"
      ? metrics.ttfbMs
      : typeof speedPayload?.loadTime === "number"
        ? Math.round(speedPayload.loadTime)
        : null;

  const totalScore =
    typeof speedReport?.summary === "object"
      ? (speedReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const lcpStatus = scoreFromProxy(proxies.lcpScore);
  const clsStatus = scoreFromProxy(proxies.clsScore);
  const inpStatus = scoreFromProxy(proxies.tbtScore);
  const ttfbStatus =
    ttfbMs == null ? "unknown" : ttfbMs < 600 ? "good" : ttfbMs < 1200 ? "needs_improvement" : "poor";

  const scores: JobReport["scores"] = {
    overall: {
      label: "Performance proxy score",
      value: typeof totalScore === "number" ? totalScore : "—",
      status: scoreFromProxy(totalScore),
    },
    LCP: {
      label: "Largest Contentful Paint (proxy)",
      value: typeof proxies.lcpScore === "number" ? `${proxies.lcpScore}/100` : "—",
      status: lcpStatus,
      primaryCause: speedFindings.find((f) => f.metric === "LCP")?.title,
    },
    TTFB: {
      label: "Time to First Byte (fetch proxy)",
      value: ttfbMs != null ? `${ttfbMs}ms` : "—",
      status: ttfbStatus,
      primaryCause:
        ttfbStatus !== "good"
          ? "Server response or network latency before HTML arrives"
          : undefined,
    },
    INP: {
      label: "Interaction delay risk (TBT proxy)",
      value: typeof proxies.tbtScore === "number" ? `${proxies.tbtScore}/100` : "—",
      status: inpStatus,
      primaryCause: "Total Blocking Time proxies main-thread blocking that affects INP",
    },
    CLS: {
      label: "Cumulative Layout Shift (proxy)",
      value: typeof proxies.clsScore === "number" ? `${proxies.clsScore}/100` : "—",
      status: clsStatus,
      primaryCause: speedFindings.find((f) => f.metric === "CLS")?.title,
    },
  };

  const findingActions = rankActions(
    findings.filter((f) => f.workstream === "performance" || f.metric),
    12
  );
  const assetActions = assetActionsFromSpeedReport(speedReport, 8);
  const prioritizedActions = mergePrioritizedActions(assetActions, findingActions).slice(0, 12);

  const worst =
    (["LCP", "TTFB", "INP", "CLS"] as const).find((m) => scores[m]?.status === "poor") ||
    (["LCP", "TTFB", "INP", "CLS"] as const).find(
      (m) => scores[m]?.status === "needs_improvement"
    );

  const summary = [
    url ? `Core Web Vitals diagnosis for ${url}.` : "Core Web Vitals diagnosis complete.",
    worst ? `Weakest metric area: ${worst}.` : "All proxy metrics look acceptable in this pass.",
    assetActions[0]
      ? `Top asset fix: ${assetActions[0].action}`
      : prioritizedActions[0]
        ? `Highest-impact fix: ${prioritizedActions[0].action}`
        : "Review findings for render and asset optimizations.",
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
      performance: { report: speedReport },
      technicalSeo: { report: seoReport },
      socialPreview: { report: socialReport },
      assets: assetOptimizer
        ? { assetOptimizer, actionCount: assetActions.length }
        : { assetOptimizer: null },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "LCP/CLS/INP scores are HTML-based proxies unless field CrUX data is integrated.",
      "INP is approximated via Total Blocking Time (TBT) proxy.",
      "TTFB uses fetch timing to first HTML response, not Chrome trace data.",
      "assetOptimizer lists are heuristic (image HEAD sizes + HTML attributes), not Lighthouse audits.",
    ],
  };
}
