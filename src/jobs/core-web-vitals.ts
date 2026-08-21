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
  PROXY_SPEED_LIMITATIONS,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
  capOverallBySiblingScores,
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
  const ttfbSource =
    typeof metrics.ttfbSource === "string" ? metrics.ttfbSource : null;
  const inpProxyLabel =
    typeof metrics.inpProxyLabel === "string"
      ? metrics.inpProxyLabel
      : "TBT proxy for INP risk";

  const totalScore =
    typeof speedReport?.summary === "object"
      ? (speedReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const lcpStatus = scoreFromProxy(proxies.lcpScore);
  const clsStatus = scoreFromProxy(proxies.clsScore);
  const inpStatus = scoreFromProxy(proxies.tbtScore);
  const ttfbStatus =
    ttfbMs == null ? "unknown" : ttfbMs < 600 ? "good" : ttfbMs < 1200 ? "needs_improvement" : "poor";

  if (
    (ttfbStatus === "poor" || ttfbStatus === "needs_improvement") &&
    !findings.some((f) => f.metric === "TTFB")
  ) {
    findings.push({
      workstream: "performance",
      severity: ttfbStatus === "poor" ? "high" : "medium",
      title:
        ttfbStatus === "poor"
          ? "Slow Time to First Byte"
          : "Moderate Time to First Byte",
      whyItMatters:
        "Slow TTFB delays LCP/FCP and every subsequent paint metric.",
      howToFix: [
        "Cache HTML at the edge where possible.",
        "Reduce origin SSR/DB work on the critical path.",
        "Use a CDN and optimize TLS handshake latency.",
      ],
      metric: "TTFB",
      evidence: { ttfbMs, ttfbSource },
    });
  }

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
    INP: {
      label: inpProxyLabel,
      value: typeof proxies.tbtScore === "number" ? `${proxies.tbtScore}/100` : "—",
      status: inpStatus,
      primaryCause: "Total Blocking Time proxies main-thread blocking that affects INP",
    },
    TTFB: {
      label:
        ttfbSource === "server-timing"
          ? "Time to First Byte (Server-Timing)"
          : "Time to First Byte (fetch proxy)",
      value: ttfbMs != null ? `${ttfbMs}ms` : "—",
      status: ttfbStatus,
      primaryCause:
        ttfbStatus !== "good"
          ? "Server response or network latency before HTML arrives"
          : undefined,
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

  const missingSteps: string[] = [];
  if (!speedReport) missingSteps.push("page speed");
  if (steps.some((s) => s.id === "seo" || s.operationId === "seoAnalyze") && !seoReport) {
    missingSteps.push("SEO");
  }
  if (
    steps.some((s) => s.id === "social" || /social/i.test(s.operationId)) &&
    !socialReport
  ) {
    missingSteps.push("social preview");
  }

  const worst =
    (["LCP", "TTFB", "INP", "CLS"] as const).find((m) => scores[m]?.status === "poor") ||
    (["LCP", "TTFB", "INP", "CLS"] as const).find(
      (m) => scores[m]?.status === "needs_improvement"
    );

  const hasProxyCoverage =
    Boolean(speedReport) &&
    [lcpStatus, clsStatus, inpStatus, ttfbStatus].every((s) => s !== "unknown");

  const evidence =
    speedReport?.evidence && typeof speedReport.evidence === "object"
      ? (speedReport.evidence as Record<string, unknown>)
      : {};
  const ao = assetOptimizer || {};
  const compressN = Array.isArray(ao.compressImages) ? ao.compressImages.length : 0;
  const deferN = Array.isArray(ao.deferScripts) ? ao.deferScripts.length : 0;
  const hasLcpCandidate = Boolean(evidence.lcpCandidate);
  const thinPageOptimism =
    hasProxyCoverage &&
    !worst &&
    compressN === 0 &&
    deferN === 0 &&
    !hasLcpCandidate &&
    speedFindings.length === 0;

  const metricLine = missingSteps.length
    ? `Incomplete: missing ${missingSteps.join(", ")} — do not treat proxy scores as a clean pass.`
    : worst
      ? `Weakest metric area: ${worst}.`
      : thinPageOptimism
        ? "Proxy scores look strong on this thin HTML snapshot — real field CrUX/Lighthouse on a full product page can still be worse. Do not treat this as production CWV proof."
        : hasProxyCoverage
          ? "No poor/needs_improvement proxy metrics in the scored areas (HTML proxies, not CrUX/Lighthouse)."
          : "Proxy coverage incomplete — re-run with a reachable URL before treating metrics as acceptable.";

  const summary = [
    url ? `Core Web Vitals diagnosis for ${url}.` : "Core Web Vitals diagnosis complete.",
    metricLine,
    assetActions[0]
      ? `Top asset fix: ${assetActions[0].action}`
      : prioritizedActions[0]
        ? `Highest-impact fix: ${prioritizedActions[0].action}`
        : "Review findings for render and asset optimizations.",
  ];

  const limitations = [
    ...PROXY_SPEED_LIMITATIONS,
    ...(thinPageOptimism
      ? [
          "Thin or mostly-static HTML often scores well on these proxies; verify with CrUX or lab Lighthouse before claiming Core Web Vitals readiness.",
        ]
      : []),
  ];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary,
    scores: capOverallBySiblingScores(scores),
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
    limitations,
  };
}
