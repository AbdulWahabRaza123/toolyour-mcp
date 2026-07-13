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

function numScore(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function keywordsFromShaped(shaped: unknown): string[] {
  const payload = unwrapToolPayload(shaped);
  if (!payload) return [];
  const keywords = payload.keywords;
  return Array.isArray(keywords) ? keywords.map(String).filter(Boolean) : [];
}

export function synthesizeContentQualityAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const contentReport = extractReport(stepResults.content);
  const keywordReport = extractReport(stepResults.keywords);

  const contentFindings = findingsFromReport(contentReport, "contentQuality");
  const keywordFindings = findingsFromReport(keywordReport, "keywordSignals");
  const findings = mergeFindings(contentFindings, keywordFindings);

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
  const keywordMetrics =
    keywordReport?.metrics && typeof keywordReport.metrics === "object"
      ? (keywordReport.metrics as Record<string, unknown>)
      : {};

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
      value: (() => {
        const metrics = contentReport?.metrics;
        if (!metrics || typeof metrics !== "object") return "—";
        const wc = (metrics as Record<string, unknown>).wordCount;
        return typeof wc === "number" ? wc : "—";
      })(),
      status: "unknown",
    },
  };

  const prioritizedActions = rankActions(findings);
  const summary = [
    url ? `Content quality audit for ${url}.` : "Content quality audit complete.",
    keywords.length
      ? `Detected ${keywords.length} keyword/topic signals from meta and headings.`
      : "Few keyword signals detected — strengthen title, H1, and meta description.",
    typeof keywordMetrics.hasH1 === "boolean" && !keywordMetrics.hasH1
      ? "Missing H1 reduces topical clarity for crawlers."
      : "",
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
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Keyword signals are extracted from on-page meta and headings, not live rank data.",
      "For AI rewrite suggestions from pasted copy, use content-improve-local with html/text input.",
    ],
  };
}
