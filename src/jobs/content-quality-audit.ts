import type { JobFinding, JobReport, SynthesizeJobParams } from "./types";
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

function numScore(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function keywordsFromShaped(shaped: unknown): string[] {
  const payload = unwrapToolPayload(shaped);
  if (!payload) return [];
  const keywords = payload.keywords;
  return Array.isArray(keywords) ? keywords.map(String).filter(Boolean) : [];
}

function metricNum(
  report: Record<string, unknown> | null,
  key: string
): number | undefined {
  if (!report?.metrics || typeof report.metrics !== "object") return undefined;
  const v = (report.metrics as Record<string, unknown>)[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function headingDepthFindings(
  contentReport: Record<string, unknown> | null,
  keywordMetrics: Record<string, unknown>
): JobFinding[] {
  const findings: JobFinding[] = [];
  const wordCount = metricNum(contentReport, "wordCount");
  const h1Count =
    typeof keywordMetrics.h1Count === "number"
      ? keywordMetrics.h1Count
      : typeof keywordMetrics.hasH1 === "boolean"
        ? keywordMetrics.hasH1
          ? 1
          : 0
        : metricNum(contentReport, "h1Count");

  if (h1Count === 0 || keywordMetrics.hasH1 === false) {
    findings.push({
      workstream: "structure",
      severity: "high",
      title: "Missing H1",
      whyItMatters:
        "Pages without a clear H1 lose topical clarity for crawlers and readers.",
      howToFix: [
        "Add one descriptive H1 that matches the primary intent of the page.",
        "Avoid duplicating the title tag verbatim if it is already keyword-stuffed.",
      ],
      metric: "H1",
    });
  } else if (typeof h1Count === "number" && h1Count > 1) {
    findings.push({
      workstream: "structure",
      severity: "medium",
      title: "Multiple H1 headings",
      whyItMatters:
        "Multiple H1s dilute the primary topic signal and confuse outline extraction.",
      howToFix: [
        "Keep a single H1; demote secondary titles to H2/H3.",
      ],
      metric: "H1",
      evidence: { h1Count },
    });
  }

  const h2Count = metricNum(contentReport, "h2Count") ??
    (typeof keywordMetrics.h2Count === "number" ? keywordMetrics.h2Count : undefined);
  if (typeof wordCount === "number" && wordCount > 400 && (h2Count ?? 0) < 2) {
    findings.push({
      workstream: "structure",
      severity: "medium",
      title: "Weak heading hierarchy",
      whyItMatters:
        "Long pages without H2 sections are harder to scan and less likely to earn snippet/faq-style coverage.",
      howToFix: [
        "Break the page into 2–5 H2 sections covering distinct subtopics.",
        "Nest supporting points under H3 only when needed.",
      ],
      evidence: { wordCount, h2Count: h2Count ?? 0 },
    });
  }

  if (typeof wordCount === "number" && wordCount > 0 && wordCount < 300) {
    findings.push({
      workstream: "contentDepth",
      severity: "high",
      title: "Thin content",
      whyItMatters:
        "Pages under ~300 words rarely satisfy informational intent or compete for non-brand queries.",
      howToFix: [
        "Expand with unique explanations, examples, and answers to related questions.",
        "Remove boilerplate and add substance instead of padding.",
      ],
      evidence: { wordCount },
    });
  }

  return findings;
}

export function synthesizeContentQualityAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const contentReport = extractReport(stepResults.content);
  const keywordReport = extractReport(stepResults.keywords);

  const contentFindings = findingsFromReport(contentReport, "contentQuality");
  const keywordFindings = findingsFromReport(keywordReport, "keywordSignals");
  const keywordMetrics =
    keywordReport?.metrics && typeof keywordReport.metrics === "object"
      ? (keywordReport.metrics as Record<string, unknown>)
      : {};
  const structureFindings = headingDepthFindings(contentReport, keywordMetrics);
  const findings = mergeFindings(
    contentFindings,
    keywordFindings,
    structureFindings
  );

  const contentScore = numScore(
    typeof contentReport?.summary === "object"
      ? (contentReport.summary as Record<string, unknown>).totalScore
      : undefined
  );
  const keywordScore = numScore(
    typeof keywordReport?.summary === "object"
      ? (keywordReport.summary as Record<string, unknown>).totalScore
      : undefined
  );

  const overall =
    contentScore != null && keywordScore != null
      ? Math.round((contentScore + keywordScore) / 2)
      : contentScore ?? keywordScore;

  const keywords = keywordsFromShaped(stepResults.keywords);
  const wordCount = metricNum(contentReport, "wordCount");
  const h1Ok =
    keywordMetrics.hasH1 === true ||
    (typeof keywordMetrics.h1Count === "number" && keywordMetrics.h1Count === 1) ||
    metricNum(contentReport, "h1Count") === 1;

  const scores: JobReport["scores"] = {
    overall: {
      label: "Content quality score",
      value: overall ?? "—",
      status: scoreFromProxy(overall),
    },
    contentQuality: {
      label: "On-page content",
      value: typeof contentScore === "number" ? contentScore : "—",
      status: scoreFromProxy(contentScore),
    },
    keywordSignals: {
      label: "Keyword & meta signals",
      value: typeof keywordScore === "number" ? keywordScore : "—",
      status: scoreFromProxy(keywordScore),
    },
    wordCount: {
      label: "Word count",
      value: wordCount ?? "—",
      status:
        typeof wordCount === "number"
          ? wordCount < 300
            ? "poor"
            : wordCount < 600
              ? "needs_improvement"
              : "good"
          : "unknown",
    },
    headingStructure: {
      label: "H1 / hierarchy",
      value: h1Ok ? "ok" : "needs work",
      status: h1Ok ? "good" : "poor",
      primaryCause: h1Ok ? undefined : "Missing or weak H1",
    },
  };

  const prioritizedActions = rankActions(findings);
  const summary = [
    url ? `Content quality audit for ${url}.` : "Content quality audit complete.",
    keywords.length
      ? `Detected ${keywords.length} keyword/topic signals from meta and headings.`
      : "Few keyword signals detected — strengthen title, H1, and meta description.",
    typeof wordCount === "number" && wordCount < 300
      ? `Thin content risk: only ${wordCount} words.`
      : "",
    !h1Ok ? "Missing or unclear H1 reduces topical clarity for crawlers." : "",
    prioritizedActions[0]
      ? `Top fix: ${prioritizedActions[0].action}`
      : "Content structure looks acceptable in this pass.",
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
      contentQuality: { report: contentReport },
      keywordSignals: { report: keywordReport, keywords: keywords.slice(0, 20) },
      structure: {
        h1Ok,
        wordCount: wordCount ?? null,
        thinContent: typeof wordCount === "number" ? wordCount < 300 : null,
      },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Keyword signals are extracted from on-page meta and headings, not live rank data.",
      "Heading hierarchy checks use available metrics from content/keyword tools; some pages may omit H2 counts.",
      "For AI rewrite suggestions from pasted copy, use content-improve-local with html/text input.",
    ],
  };
}
