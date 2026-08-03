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

function overallFromScores(scores: Array<number | undefined>): number | undefined {
  const numeric = scores.filter((s): s is number => typeof s === "number");
  if (!numeric.length) return undefined;
  return Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length);
}

function totalScoreFromReport(report: Record<string, unknown> | null): number | undefined {
  if (!report) return undefined;
  const summary = report.summary;
  if (summary && typeof summary === "object") {
    const total = (summary as Record<string, unknown>).totalScore;
    if (typeof total === "number") return total;
  }
  return undefined;
}

/** robots + sitemap + redirects — launch crawl hygiene */
export function synthesizeCrawlReadiness(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const robotsReport = extractReport(stepResults.robots);
  const sitemapReport = extractReport(stepResults.sitemap);
  const redirectReport = extractReport(stepResults.redirects);

  const findings = mergeFindings(
    findingsFromReport(robotsReport, "robots"),
    findingsFromReport(sitemapReport, "sitemap"),
    findingsFromReport(redirectReport, "redirects")
  );

  const robotsScore = totalScoreFromReport(robotsReport);
  const sitemapScore = totalScoreFromReport(sitemapReport);
  const redirectScore = totalScoreFromReport(redirectReport);
  const overall = overallFromScores([robotsScore, sitemapScore, redirectScore]);
  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Crawl readiness for ${url} (robots.txt, sitemap, redirects).`
        : "Crawl readiness check complete.",
      high
        ? `${high} high-severity crawl issue${high === 1 ? "" : "s"} — fix before relying on indexation.`
        : "No high-severity crawl blockers in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Re-check after publishing robots/sitemap changes.",
    ],
    scores: {
      overall: {
        label: "Crawl readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      robots: {
        label: "robots.txt",
        value: robotsScore ?? "—",
        status: scoreFromProxy(robotsScore),
      },
      sitemap: {
        label: "Sitemap XML",
        value: sitemapScore ?? "—",
        status: scoreFromProxy(sitemapScore),
      },
      redirects: {
        label: "Redirect chain",
        value: redirectScore ?? "—",
        status: scoreFromProxy(redirectScore),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Does not crawl the full site graph — single-URL robots/sitemap/redirect probes only.",
      "Not a Search Console indexation status check.",
    ],
  };
}

/** schema + meta + social preview tags */
export function synthesizeStructuredDataAudit(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const schemaReport = extractReport(stepResults.schema);
  const metaReport = extractReport(stepResults.meta);
  const socialReport = extractReport(stepResults.social);

  const findings = mergeFindings(
    findingsFromReport(schemaReport, "schema"),
    findingsFromReport(metaReport, "meta"),
    findingsFromReport(socialReport, "socialPreview")
  );

  const schemaScore = totalScoreFromReport(schemaReport);
  const metaScore = totalScoreFromReport(metaReport);
  const socialScore = totalScoreFromReport(socialReport);
  const overall = overallFromScores([schemaScore, metaScore, socialScore]);
  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Structured data + meta audit for ${url}.`
        : "Structured data + meta audit complete.",
      high
        ? `${high} high-severity markup issue${high === 1 ? "" : "s"}.`
        : "No high-severity markup issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Validate rich-result eligibility in Google tools after shipping schema.",
    ],
    scores: {
      overall: {
        label: "Structured data readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      schema: {
        label: "Schema markup",
        value: schemaScore ?? "—",
        status: scoreFromProxy(schemaScore),
      },
      meta: {
        label: "Meta tags",
        value: metaScore ?? "—",
        status: scoreFromProxy(metaScore),
      },
      social: {
        label: "Social preview tags",
        value: socialScore ?? "—",
        status: scoreFromProxy(socialScore),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Does not guarantee Google rich results — validates markup structure on the live URL.",
      "Social preview does not fetch third-party crawler caches.",
    ],
  };
}

/** AI Overview / GEO structural readiness (not live AIO rank) */
export function synthesizeAiOverviewReadiness(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const report = extractReport(stepResults.aio);
  const payload = unwrapToolPayload(stepResults.aio);
  const findings = findingsFromReport(report, "aiOverview");
  const score = totalScoreFromReport(report);
  const prioritizedActions = rankActions(findings, 10);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `AI Overview readiness (structural) for ${url}.`
        : "AI Overview readiness check complete.",
      high
        ? `${high} high-severity structure gap${high === 1 ? "" : "s"} for extractability.`
        : "No high-severity structural gaps in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "This is not a live AI Overview rank tracker.",
    ],
    scores: {
      overall: {
        label: "AI Overview structural readiness",
        value: score ?? "—",
        status: scoreFromProxy(score),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      metrics: report?.metrics || payload?.metrics || {},
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Structural heuristics only — does not claim presence in Google AI Overviews.",
      "No live SERP or citation tracking.",
    ],
  };
}

/** Favicon / apple-touch / manifest icons */
export function synthesizeSiteIconsAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const report = extractReport(stepResults.icons);
  const findings = findingsFromReport(report, "siteIcons");
  const score = totalScoreFromReport(report);
  const prioritizedActions = rankActions(findings, 10);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Site icons check for ${url}.` : "Site icons check complete.",
      high
        ? `${high} high-severity icon issue${high === 1 ? "" : "s"}.`
        : "No high-severity icon issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Icons look reachable for common browser/PWA entry points.",
    ],
    scores: {
      overall: {
        label: "Site icons",
        value: score ?? "—",
        status: scoreFromProxy(score),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Checks declared link rel icons and common fallbacks — not a full PWA Lighthouse audit.",
    ],
  };
}
