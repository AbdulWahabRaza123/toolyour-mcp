import type { JobReport, SynthesizeJobParams } from "./types";
import {
  extractUrl,
  findingsFromReport,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function numFrom(payload: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const nested = payload.result;
    if (nested && typeof nested === "object") {
      const n = (nested as Record<string, unknown>)[k];
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function payloadOf(stepResults: Record<string, unknown>, id: string): Record<string, unknown> | null {
  const raw = stepResults[id];
  if (!raw || typeof raw !== "object") return null;
  return unwrapToolPayload(raw as Record<string, unknown>) as Record<string, unknown>;
}

/** UTM build + platform macros + parse hygiene */
export function synthesizeCampaignTracking(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "utm") as any, "utm"),
    findingsFromReport(payloadOf(stepResults, "adsUtm") as any, "adsUtm"),
    findingsFromReport(payloadOf(stepResults, "parse") as any, "parse")
  );
  const actions = rankActions(findings, 10);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      "Campaign tracking setup complete (UTM builder, ads macros, parser).",
      actions[0] ? `Top fix: ${actions[0].action}` : "Review generated URLs before pasting into ads managers.",
    ],
    scores: {
      overall: { label: "Tracking hygiene", value: findings.length ? 70 : 90, status: scoreFromProxy(findings.length ? 70 : 90) },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Does not create ads or verify live click attribution in GA4."],
  };
}

/** Ads copy limits + RSA preview */
export function synthesizePaidAdsCopyGate(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "counter") as any, "counter"),
    findingsFromReport(payloadOf(stepResults, "rsa") as any, "rsa")
  );
  const actions = rankActions(findings, 10);
  const over = findings.filter((f) => /over|limit|exceed/i.test(f.title || "")).length;
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Paid ads copy gate complete.",
      over ? `${over} length/limit issue(s) flagged.` : "No length blockers in this pass.",
      actions[0] ? `Top fix: ${actions[0].action}` : "Copy lengths look within common platform limits.",
    ],
    scores: {
      overall: { label: "Ads copy gate", value: over ? 55 : 92, status: scoreFromProxy(over ? 55 : 92) },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Character limits are approximate platform defaults — confirm in Ads Manager."],
  };
}

/** Growth unit economics calculators */
export function synthesizeGrowthUnitEconomics(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const roas = numFrom(payloadOf(stepResults, "roas"), ["roas", "value", "result"]);
  const cpc = numFrom(payloadOf(stepResults, "cpc"), ["cpc", "value"]);
  const ctr = numFrom(payloadOf(stepResults, "ctr"), ["ctr", "value", "ctrPercent"]);
  const cpa = numFrom(payloadOf(stepResults, "cpa"), ["cpa", "value"]);
  const cac = numFrom(payloadOf(stepResults, "cac"), ["cac", "value"]);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Growth unit-economics snapshot.",
      [
        roas != null ? `ROAS ${roas}` : null,
        cpc != null ? `CPC ${cpc}` : null,
        ctr != null ? `CTR ${ctr}` : null,
        cpa != null ? `CPA ${cpa}` : null,
        cac != null ? `CAC ${cac}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Provide numeric inputs for each calculator step.",
    ],
    scores: {
      overall: {
        label: "Unit economics",
        value: roas != null ? Math.min(100, Math.round(Number(roas) * 20)) : "—",
        status: scoreFromProxy(roas != null ? Math.min(100, Math.round(Number(roas) * 20)) : undefined),
      },
    },
    findings: [],
    prioritizedActions: [],
    workstreams: { metrics: { roas, cpc, ctr, cpa, cac } },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Pure arithmetic from your inputs — not live ads platform data."],
  };
}

/** Email subject + spam heuristics */
export function synthesizeEmailCampaignQa(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "subject") as any, "subject"),
    findingsFromReport(payloadOf(stepResults, "spam") as any, "spam")
  );
  const actions = rankActions(findings, 10);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Email campaign subject/spam QA complete.",
      actions[0] ? `Top fix: ${actions[0].action}` : "No high-priority subject/spam flags.",
    ],
    scores: {
      overall: { label: "Email QA", value: findings.length ? 65 : 90, status: scoreFromProxy(findings.length ? 65 : 90) },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Heuristic spam lexicon only — not a mailbox provider spam filter.",
      "Pair with SPF/DKIM/DMARC (security) for deliverability DNS.",
    ],
  };
}

/** Landing CTA/forms/tags */
export function synthesizeLandingConversionCheck(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "cta") as any, "cta"),
    findingsFromReport(payloadOf(stepResults, "forms") as any, "forms"),
    findingsFromReport(payloadOf(stepResults, "tags") as any, "tags")
  );
  const actions = rankActions(findings, 12);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Landing conversion check for ${url}.` : "Landing conversion check complete.",
      actions[0] ? `Top fix: ${actions[0].action}` : "CTAs, forms, and tags inventoried.",
    ],
    scores: {
      overall: { label: "Landing conversion helpers", value: findings.length ? 70 : 88, status: scoreFromProxy(findings.length ? 70 : 88) },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "HTML heuristics only — not a full CRO audit or heatmaps.",
      "Pair with SEO page-speed / meta tools for ship checks.",
    ],
  };
}
