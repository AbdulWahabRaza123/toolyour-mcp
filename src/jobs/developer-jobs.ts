import type { JobReport, SynthesizeJobParams } from "./types";
import {
  findingsFromReport,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function payloadOf(stepResults: Record<string, unknown>, id: string): Record<string, unknown> | null {
  const raw = stepResults[id];
  if (!raw || typeof raw !== "object") return null;
  return unwrapToolPayload(raw as Record<string, unknown>) as Record<string, unknown>;
}

/** Validate → format → Zod codegen */
export function synthesizeDevJsonPipeline(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "validate") as any, "validate"),
    findingsFromReport(payloadOf(stepResults, "format") as any, "format"),
    findingsFromReport(payloadOf(stepResults, "zod") as any, "zod")
  );
  const actions = rankActions(findings, 10);
  const validate = payloadOf(stepResults, "validate");
  const invalid =
    validate &&
    (validate.valid === false ||
      validate.ok === false ||
      (typeof validate.error === "string" && validate.error.length > 0));

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Dev JSON pipeline complete (validate → format → Zod).",
      invalid ? "JSON validation failed — fix parse errors before codegen." : "JSON validated for this pass.",
      actions[0] ? `Top fix: ${actions[0].action}` : "Use jsonToTypescript / jsonToGoStruct / jsonToPython via invoke_tool if needed.",
    ],
    scores: {
      overall: {
        label: "JSON pipeline",
        value: invalid ? 40 : findings.length ? 75 : 95,
        status: scoreFromProxy(invalid ? 40 : findings.length ? 75 : 95),
      },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Deterministic transforms only — not an LLM schema designer.",
      "Oversized payloads may be rejected by the API.",
    ],
  };
}

/** Generate test JWT then decode claims (decode ≠ verify) */
export function synthesizeDevAuthDebug(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "generate") as any, "generate"),
    findingsFromReport(payloadOf(stepResults, "decode") as any, "decode")
  );
  const actions = rankActions(findings, 10);
  const decode = payloadOf(stepResults, "decode");
  const warnings = Array.isArray(decode?.warnings) ? decode.warnings.map(String) : [];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Dev auth debug complete (jwtGenerator → jwtDecoder).",
      warnings.length ? `${warnings.length} decode warning(s).` : "Claims decoded (signature not verified).",
      actions[0] ? `Top fix: ${actions[0].action}` : "Use jwtSignatureVerifier / secrets hygiene for production tokens.",
    ],
    scores: {
      overall: {
        label: "Auth debug",
        value: warnings.length ? 70 : 90,
        status: scoreFromProxy(warnings.length ? 70 : 90),
      },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "jwtGenerator is for test/dev HS tokens — not production IdP issuance.",
      "jwtDecoder does not verify signatures.",
    ],
  };
}

/** YAML→JSON format + optional XML pretty-print */
export function synthesizeDevFormatTransform(params: SynthesizeJobParams): JobReport {
  const { workflowId, steps, stepResults } = params;
  const findings = mergeFindings(
    findingsFromReport(payloadOf(stepResults, "yaml") as any, "yaml"),
    findingsFromReport(payloadOf(stepResults, "format") as any, "format"),
    findingsFromReport(payloadOf(stepResults, "xml") as any, "xml")
  );
  const actions = rankActions(findings, 10);

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    summary: [
      "Dev format transform complete (YAML→JSON → format → XML).",
      actions[0] ? `Top fix: ${actions[0].action}` : "Invoke language-specific formatters for HTML/CSS/JS/SQL as needed.",
    ],
    scores: {
      overall: {
        label: "Format transform",
        value: findings.length ? 75 : 92,
        status: scoreFromProxy(findings.length ? 75 : 92),
      },
    },
    findings,
    prioritizedActions: actions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "SQL validator does not execute against a database.",
      "Formatter dialects may differ from local Prettier/SQLFluff setups.",
    ],
  };
}
