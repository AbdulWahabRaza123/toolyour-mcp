import type { JobFinding, JobReport, SynthesizeJobParams } from "./types";
import {
  operationIdsFromSteps,
  rankActions,
  unwrapToolPayload,
} from "./utils";

function extractText(input: Record<string, unknown>): string | undefined {
  if (typeof input.text === "string" && input.text.trim()) return input.text.trim();
  if (typeof input.content === "string" && input.content.trim())
    return input.content.trim();
  return undefined;
}

export function synthesizeSecretsHygiene(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const textHint = extractText(input);
  const leak = unwrapToolPayload(stepResults.leak);
  const jwt = unwrapToolPayload(stepResults.jwt);

  const findings: JobFinding[] = [];
  const matches = Array.isArray(leak?.matches) ? leak.matches : Array.isArray(leak?.findings) ? leak.findings : [];

  for (const raw of matches) {
    if (!raw || typeof raw !== "object") {
      if (typeof raw === "string") {
        findings.push({
          workstream: "secrets",
          severity: "high",
          title: raw,
          whyItMatters: "Possible secret material in pasted text.",
          howToFix: ["Rotate the credential", "Remove from logs and tickets"],
        });
      }
      continue;
    }
    const m = raw as Record<string, unknown>;
    findings.push({
      workstream: "secrets",
      severity: "high",
      title: String(m.type ?? m.kind ?? m.title ?? "Possible secret"),
      whyItMatters: String(m.message ?? m.advice ?? "Looks like credential material."),
      howToFix: [
        "Rotate immediately if this was a real secret",
        "Redact before sharing with agents or tickets",
      ],
      evidence: {
        line: m.line,
        preview: m.preview ?? m.snippet,
      },
    });
  }

  if (jwt) {
    const warnings = Array.isArray(jwt.warnings) ? jwt.warnings.map(String) : [];
    for (const w of warnings) {
      findings.push({
        workstream: "jwt",
        severity: /none|expired/i.test(w) ? "high" : "medium",
        title: w,
        whyItMatters: w,
        howToFix: ["Verify signature server-side", "Do not treat decode-only as auth"],
      });
    }
  }

  const matchCount =
    typeof leak?.matchCount === "number"
      ? leak.matchCount
      : typeof leak?.count === "number"
        ? leak.count
        : findings.filter((f) => f.workstream === "secrets").length;

  const prioritizedActions = rankActions(findings, 10);

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url: undefined,
    gatePolicy: "secrets",
    summary: [
      textHint
        ? `Scanned pasted text (${Math.min(textHint.length, 80)}… chars) for leaked secrets.`
        : "Secrets hygiene scan complete.",
      matchCount
        ? `${matchCount} possible secret pattern(s) flagged.`
        : "No common secret patterns detected (heuristics only).",
      prioritizedActions[0]
        ? `Top action: ${prioritizedActions[0].action}`
        : "Prefer piiScrub before pasting production logs into agents.",
    ],
    scores: {
      overall: {
        label: "Secrets hygiene",
        value: matchCount === 0 ? 100 : Math.max(0, 100 - matchCount * 15),
        status:
          matchCount === 0
            ? "good"
            : matchCount < 3
              ? "needs_improvement"
              : "poor",
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      secrets: { data: leak },
      jwt: { data: jwt },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Heuristic pattern matching only — not a breach database or entropy oracle.",
      "Gate policy (secrets): any secrets/jwt finding fails — rotate and re-verify until clean.",
      "False positives are possible; false negatives are also possible.",
      "Never paste production secrets into public forms when avoidable.",
    ],
  };
}
