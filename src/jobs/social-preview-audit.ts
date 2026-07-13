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

export function synthesizeSocialPreviewAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const socialShaped = stepResults.social;

  const socialReport = extractReport(socialShaped);
  const socialPayload = unwrapToolPayload(socialShaped);
  const findings = findingsFromReport(socialReport, "socialPreview");

  const socialScore =
    typeof socialReport?.summary === "object"
      ? (socialReport.summary as Record<string, unknown>).totalScore
      : undefined;

  const metrics =
    socialReport?.metrics && typeof socialReport.metrics === "object"
      ? (socialReport.metrics as Record<string, unknown>)
      : {};

  const scores: JobReport["scores"] = {
    overall: {
      label: "Social preview readiness",
      value: typeof socialScore === "number" ? socialScore : "—",
      status: scoreFromProxy(socialScore),
    },
    openGraph: {
      label: "Open Graph coverage",
      value:
        typeof metrics.missingOpenGraphCount === "number"
          ? `${Math.max(0, 5 - metrics.missingOpenGraphCount)}/5 core tags`
          : "—",
      status:
        typeof metrics.missingOpenGraphCount === "number"
          ? metrics.missingOpenGraphCount === 0
            ? "good"
            : metrics.missingOpenGraphCount <= 2
              ? "needs_improvement"
              : "poor"
          : "unknown",
    },
    twitterCard: {
      label: "Twitter Card coverage",
      value:
        typeof metrics.missingTwitterCount === "number"
          ? `${Math.max(0, 4 - metrics.missingTwitterCount)}/4 core tags`
          : "—",
      status:
        typeof metrics.missingTwitterCount === "number"
          ? metrics.missingTwitterCount === 0
            ? "good"
            : metrics.missingTwitterCount <= 2
              ? "needs_improvement"
              : "poor"
          : "unknown",
    },
  };

  const prioritizedActions = rankActions(findings);
  const ogTitle =
    socialPayload?.openGraphTags &&
    typeof socialPayload.openGraphTags === "object"
      ? (socialPayload.openGraphTags as Record<string, string>)["og:title"]
      : undefined;

  const summary = [
    url ? `Social preview audit for ${url}.` : "Social preview audit complete.",
    ogTitle ? `Current og:title preview: "${String(ogTitle).slice(0, 80)}".` : "og:title is missing.",
    prioritizedActions[0]
      ? `Top fix: ${prioritizedActions[0].action}`
      : "Open Graph and Twitter Card tags look complete.",
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
      socialPreview: {
        report: socialReport,
        openGraphTags: socialPayload?.openGraphTags,
        twitterCardTags: socialPayload?.twitterCardTags,
      },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Preview audit reads meta tags only — it does not fetch or validate image dimensions at share time.",
      "Platform-specific crops may still differ from og:image aspect ratio.",
    ],
  };
}
