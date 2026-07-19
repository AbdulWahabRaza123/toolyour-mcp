import type { JobFinding, JobReport, SynthesizeJobParams } from "./types";
import {
  extractReport,
  extractUrl,
  findingsFromReport,
  hubPagesFromShaped,
  mergeFindings,
  operationIdsFromSteps,
  prioritizedLinkSuggestionsFromShaped,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function orphanFindings(orphanPages: string[]): JobFinding[] {
  return orphanPages.slice(0, 10).map((page) => ({
    workstream: "linkGraph",
    severity: "medium" as const,
    title: `Orphan page: ${page}`,
    whyItMatters: "No internal links point to this page, so crawlers and users may never discover it.",
    howToFix: [
      `Add contextual internal links from a related hub page to ${page}.`,
      "Include the page in navigation or related-content modules where relevant.",
    ],
    evidence: { url: page },
  }));
}

function brokenLinkFindings(
  broken: Array<{ from: string; to: string; status?: number }>
): JobFinding[] {
  return broken.slice(0, 15).map((link) => ({
    workstream: "linkGraph",
    severity: "high" as const,
    title: `Broken internal link: ${link.from} → ${link.to}`,
    whyItMatters: "Broken links waste crawl budget and hurt user experience.",
    howToFix: [
      `Fix or redirect ${link.to} and update the link on ${link.from}.`,
      "Remove the link if the destination was intentionally retired.",
    ],
    evidence: { from: link.from, to: link.to, status: link.status },
  }));
}

export function synthesizeInternalLinkArchitecture(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const graphShaped = stepResults.graph;
  const hubShaped = stepResults.hub;
  const seoShaped = stepResults.seo;

  const graphReport = extractReport(graphShaped);
  const hubReport = extractReport(hubShaped);
  const seoReport = extractReport(seoShaped);
  const graphPayload = unwrapToolPayload(graphShaped);

  const graphFindings = findingsFromReport(graphReport, "linkGraph");
  const hubFindings = findingsFromReport(hubReport, "linkProfile");
  const seoFindings = findingsFromReport(seoReport, "hubSeo");

  const orphanPages = Array.isArray(graphPayload?.orphanPages)
    ? (graphPayload.orphanPages as string[])
    : [];
  const brokenLinks = Array.isArray(graphPayload?.brokenLinks)
    ? (graphPayload.brokenLinks as Array<{ from: string; to: string; status?: number }>)
    : [];

  const findings = mergeFindings(
    graphFindings,
    hubFindings,
    seoFindings,
    orphanFindings(orphanPages),
    brokenLinkFindings(brokenLinks)
  );

  const linkScore =
    typeof graphReport?.summary === "object"
      ? (graphReport.summary as Record<string, unknown>).totalScore
      : undefined;
  const profileScore =
    typeof hubReport?.summary === "object"
      ? (hubReport.summary as Record<string, unknown>).totalScore
      : undefined;
  const hubSeoScore =
    typeof seoReport?.summary === "object"
      ? (seoReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const hubPages = hubPagesFromShaped(graphShaped);
  const linkActions = prioritizedLinkSuggestionsFromShaped(graphShaped, 15);
  const brokenActions = brokenLinks.slice(0, 10).map((link, i) => ({
    rank: i + 1,
    workstream: "linkGraph",
    action: `Fix broken link on ${link.from} pointing to ${link.to}`,
    expectedImpact: "high" as const,
    effort: "low" as const,
  }));

  const prioritizedActions = [...brokenActions, ...linkActions]
    .slice(0, 15)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const fallbackActions = rankActions(findings, 15);
  const actions =
    prioritizedActions.length > 0
      ? prioritizedActions
      : fallbackActions;

  const scores: JobReport["scores"] = {
    overall: {
      label: "Internal link architecture health",
      value:
        typeof linkScore === "number" && typeof profileScore === "number"
          ? Math.round((linkScore + profileScore) / 2)
          : typeof linkScore === "number"
            ? linkScore
            : "—",
      status: scoreFromProxy(linkScore),
    },
    linkGraph: {
      label: "Site link graph health",
      value: typeof linkScore === "number" ? linkScore : "—",
      status: scoreFromProxy(linkScore),
    },
    linkProfile: {
      label: "Seed page link profile",
      value: typeof profileScore === "number" ? profileScore : "—",
      status: scoreFromProxy(profileScore),
    },
    hubSeo: {
      label: "Hub page on-page SEO",
      value: typeof hubSeoScore === "number" ? hubSeoScore : "—",
      status: scoreFromProxy(hubSeoScore),
    },
    orphanPages: {
      label: "Orphan pages in crawl window",
      value: orphanPages.length,
      status:
        orphanPages.length === 0
          ? "good"
          : orphanPages.length <= 3
            ? "needs_improvement"
            : "poor",
    },
    brokenLinks: {
      label: "Broken internal links",
      value: brokenLinks.length,
      status:
        brokenLinks.length === 0
          ? "good"
          : brokenLinks.length <= 2
            ? "needs_improvement"
            : "poor",
    },
    hubPages: {
      label: "Hub candidates discovered",
      value: hubPages.length,
      status: hubPages.length > 0 ? "good" : "unknown",
      primaryCause: hubPages[0] ? hubPages[0].url : undefined,
    },
  };

  const summary = [
    url
      ? `Internal link architecture review for ${url}.`
      : "Internal link architecture review complete.",
    `${orphanPages.length} orphan page(s); ${brokenLinks.length} broken internal link(s); ${hubPages.length} hub candidate(s).`,
    brokenLinks.length
      ? `Fix broken links first (${brokenLinks[0].from} → ${brokenLinks[0].to}).`
      : orphanPages.length
        ? `${orphanPages.length} orphan page(s) need inbound links — top listed in findings.`
        : hubPages[0]
          ? `Strongest hub candidate: ${hubPages[0].url}.`
          : actions[0]
            ? `Top action: ${actions[0].action}`
            : "Review link graph details for next steps.",
  ];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary,
    scores,
    findings,
    prioritizedActions: actions,
    workstreams: {
      linkGraph: {
        report: graphReport,
        orphanPages: orphanPages.slice(0, 10),
        brokenLinks,
        hubPages: hubPages.slice(0, 10),
        suggestedLinks: linkActions,
      },
      linkProfile: { report: hubReport },
      hubSeo: { report: seoReport },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Crawl depth and page limits may not cover the entire site.",
      "Orphan detection depends on links discovered within the crawl boundary.",
      "Hub SEO step analyzes the seed URL only, not every orphan page.",
    ],
  };
}
