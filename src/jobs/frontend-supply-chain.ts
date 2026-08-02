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
import { findingsFromSecurityPayload } from "./full-security-audit";

/**
 * Frontend supply-chain posture: SRI + mixed content + CORS.
 * CSP string evaluation stays invoke_tool(cspPolicyEvaluator).
 */
export function synthesizeFrontendSupplyChain(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const sri = unwrapToolPayload(stepResults.sri);
  const cors = unwrapToolPayload(stepResults.cors);
  const mixedReport = extractReport(stepResults.mixed);
  const mixedPayload = unwrapToolPayload(stepResults.mixed);

  const findings = mergeFindings(
    findingsFromSecurityPayload(sri, "sri"),
    findingsFromSecurityPayload(cors, "cors"),
    findingsFromReport(mixedReport, "mixedContent")
  );

  const sriScore = typeof sri?.score === "number" ? sri.score : undefined;
  const corsScore = typeof cors?.score === "number" ? cors.score : undefined;
  const mixedScore =
    typeof mixedReport?.summary === "object"
      ? (mixedReport.summary as Record<string, unknown>).totalScore
      : typeof mixedPayload?.score === "number"
        ? mixedPayload.score
        : undefined;

  const numeric = [sriScore, corsScore, mixedScore].filter(
    (s): s is number => typeof s === "number"
  );
  const overall =
    numeric.length > 0
      ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length)
      : undefined;

  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Frontend supply-chain check for ${url} (SRI, mixed content, CORS).`
        : "Frontend supply-chain check complete.",
      high
        ? `${high} high-severity issue${high === 1 ? "" : "s"} — prioritize integrity and HTTPS assets.`
        : "No high-severity supply-chain issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Paste a CSP string into cspPolicyEvaluator for policy-authoring gaps.",
    ],
    scores: {
      overall: {
        label: "Frontend supply-chain posture",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      sri: {
        label: "Subresource integrity",
        value: typeof sriScore === "number" ? sriScore : "—",
        status: scoreFromProxy(sriScore),
      },
      mixedContent: {
        label: "Mixed content",
        value: typeof mixedScore === "number" ? mixedScore : "—",
        status: scoreFromProxy(
          typeof mixedScore === "number" ? mixedScore : undefined
        ),
      },
      cors: {
        label: "CORS policy",
        value: typeof corsScore === "number" ? corsScore : "—",
        status: scoreFromProxy(corsScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      sri: { data: sri },
      mixedContent: { data: mixedPayload },
      cors: { data: cors },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Does not evaluate a pasted CSP string — use cspPolicyEvaluator for that.",
      "SRI coverage depends on script/link tags discovered on the fetched HTML.",
      "CORS checks reflect browser-visible response headers for this URL only.",
    ],
  };
}
