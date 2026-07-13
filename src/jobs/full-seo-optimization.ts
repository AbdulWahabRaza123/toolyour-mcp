import type { JobFinding, JobReport, PrioritizedAction, SynthesizeJobParams } from "./types";
import {
  extractReport,
  extractUrl,
  findingsFromReport,
  mergeFindings,
  operationIdsFromSteps,
  prioritizedLinkSuggestionsFromShaped,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function appendLinkFindings(findings: JobFinding[], shaped: unknown): JobFinding[] {
  const suggestions = prioritizedLinkSuggestionsFromShaped(shaped, 5);
  if (!suggestions.length) return findings;
  const extra: JobFinding[] = suggestions.slice(0, 5).map((s) => ({
    workstream: "internalLinking",
    severity: s.expectedImpact === "high" ? "high" : "medium",
    title: s.action,
    whyItMatters: "Contextual internal links help orphan or weak pages get discovered and pass authority.",
    howToFix: [s.action],
  }));
  return mergeFindings(findings, extra);
}

export function synthesizeFullSeoOptimization(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const seoReport = extractReport(stepResults.seo);
  const contentReport = extractReport(stepResults.content);
  const speedReport = extractReport(stepResults.speed);
  const linksReport = extractReport(stepResults.links);
  const extractReportData = extractReport(stepResults.extract);
  const socialReport = extractReport(stepResults.social);

  const seoFindings = findingsFromReport(seoReport, "technicalSeo");
  const contentFindings = findingsFromReport(contentReport, "contentQuality");
  const speedFindings = findingsFromReport(speedReport, "performance");
  const linksFindings = findingsFromReport(linksReport, "internalLinking");
  const extractFindings = findingsFromReport(extractReportData, "linkProfile");
  const socialFindings = findingsFromReport(socialReport, "socialPreview");

  let findings = mergeFindings(
    seoFindings,
    contentFindings,
    speedFindings,
    linksFindings,
    extractFindings,
    socialFindings
  );
  findings = appendLinkFindings(findings, stepResults.links);

  const scoreOf = (report: Record<string, unknown> | null) =>
    typeof report?.summary === "object"
      ? (report.summary as Record<string, unknown>).totalScore
      : undefined;

  const technicalSeoScore = scoreOf(seoReport);
  const contentScore = scoreOf(contentReport);
  const performanceScore = scoreOf(speedReport);
  const linkingScore = scoreOf(linksReport);
  const linkProfileScore = scoreOf(extractReportData);
  const socialScore = scoreOf(socialReport);

  const numericScores = [
    technicalSeoScore,
    contentScore,
    performanceScore,
    linkingScore,
    linkProfileScore,
    socialScore,
  ].filter((s): s is number => typeof s === "number");
  const overall =
    numericScores.length > 0
      ? Math.round(numericScores.reduce((a, b) => a + b, 0) / numericScores.length)
      : undefined;

  const proxies =
    speedReport?.metrics && typeof speedReport.metrics === "object"
      ? ((speedReport.metrics as Record<string, unknown>).proxies as Record<string, unknown>)
      : {};

  const scores: JobReport["scores"] = {
    overall: {
      label: "Combined SEO optimization score",
      value: overall ?? "—",
      status: scoreFromProxy(overall),
    },
    technicalSeo: {
      label: "Technical SEO",
      value: typeof technicalSeoScore === "number" ? technicalSeoScore : "—",
      status: scoreFromProxy(technicalSeoScore),
    },
    contentQuality: {
      label: "Content quality",
      value: typeof contentScore === "number" ? contentScore : "—",
      status: scoreFromProxy(contentScore),
    },
    performance: {
      label: "Page speed proxy",
      value: typeof performanceScore === "number" ? performanceScore : "—",
      status: scoreFromProxy(performanceScore),
    },
    internalLinking: {
      label: "Internal linking health",
      value: typeof linkingScore === "number" ? linkingScore : "—",
      status: scoreFromProxy(linkingScore),
    },
    linkProfile: {
      label: "On-page link profile",
      value: typeof linkProfileScore === "number" ? linkProfileScore : "—",
      status: scoreFromProxy(linkProfileScore),
    },
    socialPreview: {
      label: "Social preview",
      value: typeof socialScore === "number" ? socialScore : "—",
      status: scoreFromProxy(socialScore),
    },
    LCP: {
      label: "LCP proxy",
      value: typeof proxies.lcpScore === "number" ? `${proxies.lcpScore}/100` : "—",
      status: scoreFromProxy(proxies.lcpScore),
    },
  };

  const linkActions = prioritizedLinkSuggestionsFromShaped(stepResults.links, 10);
  const prioritizedActions = [
    ...linkActions,
    ...rankActions(findings).filter(
      (a) => !linkActions.some((l) => l.action === a.action)
    ),
  ]
    .slice(0, 15)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const performancePoor =
    typeof performanceScore === "number" && scoreFromProxy(performanceScore) !== "good";

  const summary = [
    url ? `Full SEO optimization report for ${url}.` : "Full SEO optimization complete.",
    `${findings.filter((f) => f.severity === "high").length} high-severity issues across ${numericScores.length} workstreams.`,
    prioritizedActions[0]
      ? `Top action: ${prioritizedActions[0].action}`
      : "Review workstream reports for next steps.",
    performancePoor
      ? "Performance proxy is weak — run improve-core-web-vitals for a CWV-focused follow-up."
      : "",
  ].filter(Boolean);

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
      contentQuality: { report: contentReport },
      performance: { report: speedReport },
      internalLinking: { report: linksReport },
      linkProfile: { report: extractReportData },
      socialPreview: { report: socialReport },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Internal linking crawl is bounded by plan limits and may not cover the entire site.",
      "Speed metrics are HTML-based proxies, not field CrUX data.",
      "Link suggestions are heuristic — verify relevance before publishing.",
    ],
  };
}
