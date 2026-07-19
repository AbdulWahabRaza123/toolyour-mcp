import type { JobFinding, JobReport, PrioritizedAction, SynthesizeJobParams } from "./types";
import {
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

type WorstRow = {
  url?: string;
  finalUrl?: string;
  score?: number;
  grade?: string;
  status?: number | null;
  issues?: string[];
};

function worstRowsFromBulk(payload: Record<string, unknown> | null): WorstRow[] {
  if (!payload) return [];
  if (Array.isArray(payload.worstUrls)) return payload.worstUrls as WorstRow[];
  if (Array.isArray(payload.results)) {
    return [...(payload.results as WorstRow[])].sort(
      (a, b) => (a.score ?? 0) - (b.score ?? 0)
    );
  }
  return [];
}

function urlOf(row: WorstRow): string {
  return String(row.url || row.finalUrl || "").trim();
}

export function synthesizeSeoDeployRegression(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const bulkShaped = stepResults.bulk;
  const diffShaped = stepResults.diff;

  const bulkReport = extractReport(bulkShaped);
  const diffReport = extractReport(diffShaped);
  const bulkPayload = unwrapToolPayload(bulkShaped);
  const diffPayload = unwrapToolPayload(diffShaped);

  const url =
    extractUrl(input, stepResults) ||
    (typeof bulkPayload?.url === "string" ? bulkPayload.url : undefined) ||
    (Array.isArray(input.urls) && typeof input.urls[0] === "string"
      ? input.urls[0]
      : undefined);

  const metrics =
    bulkReport?.metrics && typeof bulkReport.metrics === "object"
      ? (bulkReport.metrics as Record<string, unknown>)
      : {};
  const avgScore =
    typeof metrics.avgScore === "number"
      ? metrics.avgScore
      : typeof bulkReport?.summary === "object"
        ? (bulkReport.summary as Record<string, unknown>).totalScore
        : undefined;
  const minScore = typeof metrics.minScore === "number" ? metrics.minScore : undefined;
  const urlCount =
    typeof metrics.urlCount === "number"
      ? metrics.urlCount
      : Array.isArray(bulkPayload?.results)
        ? bulkPayload.results.length
        : Array.isArray(input.urls)
          ? input.urls.length
          : 0;

  const worst = worstRowsFromBulk(bulkPayload).slice(0, 8);
  const bulkFindings = findingsFromReport(bulkReport, "bulkScorecard");
  const diffFindings = findingsFromReport(diffReport, "seoDiff");

  const worstFindings: JobFinding[] = worst.slice(0, 5).map((row) => {
    const page = urlOf(row) || "unknown URL";
    const issues = Array.isArray(row.issues) ? row.issues.slice(0, 4) : [];
    return {
      workstream: "worstUrls",
      severity: (row.score ?? 100) < 60 ? "high" : (row.score ?? 100) < 80 ? "medium" : "low",
      title: `Weak page after deploy: ${page} (${row.score ?? "—"}/100)`,
      whyItMatters:
        "Low lite-scorecard pages are the first place to look for post-deploy SEO regressions.",
      howToFix: [
        ...issues.map((i) => `${page}: ${i}`),
        `Open SEO Change Diff against staging/previous for template pages like ${page}.`,
        "Re-run bulk URL SEO auditor after fixes.",
      ],
      evidence: { url: page, score: row.score, grade: row.grade, status: row.status, issues },
    };
  });

  const findings = mergeFindings(diffFindings, worstFindings, bulkFindings);

  const worstActions: PrioritizedAction[] = worst.slice(0, 5).map((row, i) => {
    const page = urlOf(row) || "page";
    return {
      rank: i + 1,
      workstream: "worstUrls",
      action: `Fix high-priority issues on ${page} (score ${row.score ?? "—"}/100)`,
      expectedImpact: (row.score ?? 100) < 60 ? "high" : "medium",
      effort: "medium",
    };
  });

  const playbookActions: PrioritizedAction[] = [
    {
      rank: 1,
      workstream: "regression",
      action: "Re-run bulk URL SEO auditor on the same URL list after fixes",
      expectedImpact: "medium",
      effort: "low",
    },
  ];
  if (worst[0] && urlOf(worst[0])) {
    playbookActions.unshift({
      rank: 1,
      workstream: "regression",
      action: `Diff template URL against staging/previous with SEO Change Diff (start with ${urlOf(worst[0])})`,
      expectedImpact: "high",
      effort: "low",
    });
  }

  const diffActions = rankActions(diffFindings, 6);
  const prioritizedActions = mergePrioritizedActions(
    worstActions,
    diffActions,
    playbookActions
  ).slice(0, 12);

  const hasDiff = Boolean(diffReport || diffPayload);
  const summary = [
    url
      ? `Post-deploy SEO regression review for ${urlCount || "your"} URL(s) (seed ${url}).`
      : `Post-deploy SEO regression review across ${urlCount || "listed"} URL(s).`,
    typeof avgScore === "number"
      ? `Bulk lite average ${avgScore}/100${typeof minScore === "number" ? ` (worst ${minScore}/100)` : ""}.`
      : "Bulk lite scorecard completed.",
    worst[0] && urlOf(worst[0])
      ? `Weakest page: ${urlOf(worst[0])} (${worst[0].score ?? "—"}/100).`
      : "No weak pages flagged in this bulk pass.",
    hasDiff
      ? "Template SEO Change Diff included — review field-level regressions next."
      : "For template pages, run SEO Change Diff (staging vs production) then re-bulk.",
  ];

  const scores: JobReport["scores"] = {
    overall: {
      label: "Bulk lite average score",
      value: typeof avgScore === "number" ? avgScore : "—",
      status: scoreFromProxy(avgScore),
    },
    urlCount: {
      label: "URLs analyzed",
      value: urlCount,
      status: urlCount > 0 ? "good" : "unknown",
    },
    minScore: {
      label: "Worst page score",
      value: typeof minScore === "number" ? minScore : worst[0]?.score ?? "—",
      status: scoreFromProxy(
        typeof minScore === "number" ? minScore : worst[0]?.score
      ),
      primaryCause: worst[0] ? urlOf(worst[0]) : undefined,
    },
  };

  if (hasDiff && diffReport?.summary && typeof diffReport.summary === "object") {
    const diffScore = (diffReport.summary as Record<string, unknown>).totalScore;
    scores.templateDiff = {
      label: "Template SEO change diff",
      value: typeof diffScore === "number" ? diffScore : "—",
      status: scoreFromProxy(diffScore),
    };
  }

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
      bulk: {
        report: bulkReport,
        worstUrls: worst,
        metrics,
      },
      seoDiff: hasDiff
        ? { report: diffReport, data: diffPayload }
        : { skipped: true, hint: "Pass urlA + urlB to seo-deploy-regression-diff-job" },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Bulk pass is a lite scorecard (status, title, meta, canonical, H1) — not a full crawl or page-speed run.",
      "Optional SEO Change Diff covers one URL pair (e.g. staging vs production template), not every URL.",
      "No live keyword ranks, backlinks, or AI Overview presence — no paid SERP/GEO data.",
    ],
  };
}
