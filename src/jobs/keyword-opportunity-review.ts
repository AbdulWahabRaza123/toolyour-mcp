import type { JobReport, PrioritizedAction, SynthesizeJobParams } from "./types";
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

function keywordOpportunityActions(
  keywords: string[],
  keywordReport: Record<string, unknown> | null
): PrioritizedAction[] {
  const actions: PrioritizedAction[] = [];
  const recs = Array.isArray(keywordReport?.recommendations)
    ? (keywordReport.recommendations as string[])
    : [];
  for (const rec of recs.slice(0, 3)) {
    actions.push({
      rank: actions.length + 1,
      workstream: "keywordOpportunities",
      action: rec,
      expectedImpact: "medium",
      effort: "medium",
    });
  }
  if (keywords.length < 3) {
    actions.push({
      rank: actions.length + 1,
      workstream: "keywordOpportunities",
      action: "Define one primary keyword and 3–5 supporting phrases in title, H1, and intro.",
      expectedImpact: "high",
      effort: "low",
    });
  }
  const evidence =
    keywordReport?.evidence && typeof keywordReport.evidence === "object"
      ? (keywordReport.evidence as Record<string, unknown>)
      : {};
  const title = typeof evidence.title === "string" ? evidence.title : "";
  const h1 = typeof evidence.h1 === "string" ? evidence.h1 : "";
  if (title && h1 && title.toLowerCase() !== h1.toLowerCase()) {
    actions.push({
      rank: actions.length + 1,
      workstream: "keywordOpportunities",
      action: "Align title tag and H1 around the same primary topic phrase.",
      expectedImpact: "medium",
      effort: "low",
    });
  }
  return actions.slice(0, 10);
}

export function synthesizeKeywordOpportunityReview(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const keywordReport = extractReport(stepResults.keywords);
  const contentReport = extractReport(stepResults.content);

  const keywordFindings = findingsFromReport(keywordReport, "keywordOpportunities");
  const contentFindings = findingsFromReport(contentReport, "contentQuality");
  const findings = mergeFindings(keywordFindings, contentFindings);

  const keywordScore = numScore(
    typeof keywordReport?.summary === "object"
      ? (keywordReport.summary as Record<string, unknown>).totalScore
      : undefined
  );
  const contentScore = numScore(
    typeof contentReport?.summary === "object"
      ? (contentReport.summary as Record<string, unknown>).totalScore
      : undefined
  );

  const keywords = keywordsFromShaped(stepResults.keywords);
  const overall =
    keywordScore != null && contentScore != null
      ? Math.round(keywordScore * 0.55 + contentScore * 0.45)
      : keywordScore ?? contentScore;

  const scores: JobReport["scores"] = {
    overall: {
      label: "Keyword opportunity score",
      value: overall ?? "—",
      status: scoreFromProxy(overall),
    },
    keywordOpportunities: {
      label: "Keyword & meta alignment",
      value: typeof keywordScore === "number" ? keywordScore : "—",
      status: scoreFromProxy(keywordScore),
    },
    contentCoverage: {
      label: "Content depth vs intent",
      value: typeof contentScore === "number" ? contentScore : "—",
      status: scoreFromProxy(contentScore),
    },
    topicSignals: {
      label: "Detected topic signals",
      value: keywords.length,
      status: keywords.length >= 5 ? "good" : keywords.length >= 2 ? "needs_improvement" : "poor",
    },
  };

  const keywordActions = keywordOpportunityActions(keywords, keywordReport);
  const contentActions = rankActions(contentFindings, 8);
  const prioritizedActions = [...keywordActions, ...contentActions]
    .filter(
      (a, i, arr) => arr.findIndex((x) => x.action === a.action) === i
    )
    .slice(0, 12)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const summary = [
    url ? `Keyword opportunity review for ${url}.` : "Keyword opportunity review complete.",
    keywords.length
      ? `Top signals: ${keywords.slice(0, 5).join(", ")}.`
      : "No strong keyword signals found — expand title, H1, and body coverage.",
    prioritizedActions[0]
      ? `Priority: ${prioritizedActions[0].action}`
      : "Review keyword and content workstreams for gaps.",
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
      keywordOpportunities: {
        report: keywordReport,
        keywords: keywords.slice(0, 25),
        opportunities: prioritizedActions.filter((a) => a.workstream === "keywordOpportunities"),
      },
      contentQuality: { report: contentReport },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "This review infers opportunities from on-page signals — not Search Console rank or volume data.",
      "Pair with full-seo-optimization for technical, link, and speed workstreams.",
    ],
  };
}
