import type { JobReport, SynthesizeJobParams } from "./types";
import {
  extractUrl,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";
import { findingsFromSecurityPayload } from "./full-security-audit";

export function synthesizeEmailAuthSecurity(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const spf = unwrapToolPayload(stepResults.spf);
  const dns = unwrapToolPayload(stepResults.dns);
  const txt = unwrapToolPayload(stepResults.securityTxt);

  const findings = mergeFindings(
    findingsFromSecurityPayload(spf, "emailAuth"),
    findingsFromSecurityPayload(txt, "securityTxt")
  );

  if (dns && !dns.records) {
    /* no-op */
  } else if (dns?.records && typeof dns.records === "object") {
    const mx = (dns.records as Record<string, unknown>).MX;
    if (mx == null) {
      findings.push({
        workstream: "dns",
        severity: "medium",
        title: "No MX records resolved",
        whyItMatters: "Domain may not receive email, or DNS failed for MX.",
        howToFix: ["Confirm MX at your DNS provider if mail is expected."],
      });
    }
  }

  const spfScore =
    typeof spf?.score === "number"
      ? spf.score
      : typeof txt?.score === "number"
        ? txt.score
        : undefined;
  const txtScore = typeof txt?.score === "number" ? txt.score : undefined;
  const numeric = [spfScore, txtScore].filter(
    (s): s is number => typeof s === "number"
  );
  const overall =
    numeric.length > 0
      ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length)
      : undefined;

  const prioritizedActions = rankActions(findings, 10);

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `DNS / email security pass for ${url}.`
        : "DNS / email security pass complete.",
      `${findings.filter((f) => f.severity === "high").length} high-severity issues.`,
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Review SPF/DKIM/DMARC and security.txt details.",
    ],
    scores: {
      overall: {
        label: "Email + disclosure posture",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      emailAuth: {
        label: "SPF/DKIM/DMARC",
        value: typeof spfScore === "number" ? spfScore : "—",
        status: scoreFromProxy(spfScore),
      },
      securityTxt: {
        label: "security.txt",
        value: typeof txtScore === "number" ? txtScore : "—",
        status: scoreFromProxy(txtScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      emailAuth: { data: spf },
      dns: { data: dns },
      securityTxt: { data: txt },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "DNS is resolved from the API host — not DNSSEC.",
      "DKIM selector discovery may be incomplete without a known selector.",
    ],
  };
}
