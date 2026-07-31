import type { JobFinding, JobReport, SynthesizeJobParams } from "./types";
import {
  extractUrl,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function severityFromCheck(raw: unknown): JobFinding["severity"] {
  const s = String(raw ?? "").toLowerCase();
  if (s === "fail" || s === "high" || s === "critical") return "high";
  if (s === "warn" || s === "medium" || s === "warning") return "medium";
  return "low";
}

/** Map security tool check rows (headers/cookies/TLS findings) into JobFindings. */
export function findingsFromSecurityPayload(
  payload: Record<string, unknown> | null,
  workstream: string
): JobFinding[] {
  if (!payload) return [];
  const out: JobFinding[] = [];

  const checks = Array.isArray(payload.checks) ? payload.checks : [];
  for (const raw of checks) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const severity = severityFromCheck(c.severity);
    if (severity === "low" && c.present === true && !c.issues) continue;
    const title = String(c.name ?? c.id ?? "Security check");
    const advice = String(c.advice ?? "");
    out.push({
      workstream,
      severity,
      title,
      whyItMatters: advice || `${title} needs review.`,
      howToFix: advice ? [advice] : [],
      evidence: {
        present: c.present,
        value: c.value ?? null,
        severity: c.severity,
      },
    });
  }

  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  for (const f of findings) {
    const title = typeof f === "string" ? f : String((f as Record<string, unknown>)?.title ?? f);
    out.push({
      workstream,
      severity: severityFromCheck(payload.severity ?? "warn"),
      title,
      whyItMatters: title,
      howToFix: [],
    });
  }

  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  for (const raw of cookies) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const issues = Array.isArray(c.issues) ? c.issues.map(String) : [];
    if (issues.length === 0) continue;
    out.push({
      workstream,
      severity: severityFromCheck(c.severity),
      title: `Cookie ${String(c.name ?? "unnamed")}`,
      whyItMatters: issues.join("; "),
      howToFix: issues.map((i) => `Fix: ${i}`),
    });
  }

  return out;
}

function scoreFromPayload(payload: Record<string, unknown> | null): number | undefined {
  if (!payload) return undefined;
  if (typeof payload.score === "number") return payload.score;
  return undefined;
}

export function synthesizeFullSecurityAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const headers = unwrapToolPayload(stepResults.headers);
  const tls = unwrapToolPayload(stepResults.tls);
  const cookies = unwrapToolPayload(stepResults.cookies);

  const findings = mergeFindings(
    findingsFromSecurityPayload(headers, "securityHeaders"),
    findingsFromSecurityPayload(tls, "tls"),
    findingsFromSecurityPayload(cookies, "cookies")
  );

  const headerScore = scoreFromPayload(headers);
  const cookieScore = scoreFromPayload(cookies);
  const tlsSeverity = String(tls?.severity ?? "");
  const tlsScore =
    tlsSeverity === "fail" ? 25 : tlsSeverity === "warn" ? 60 : typeof tls?.daysRemaining === "number" ? 90 : undefined;

  const numeric = [headerScore, cookieScore, tlsScore].filter(
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
        ? `Security audit for ${url}: headers, TLS certificate, and cookies.`
        : "Security audit complete (headers, TLS, cookies).",
      high
        ? `${high} high-severity issues need attention first.`
        : "No high-severity issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Review step details for hardening opportunities.",
    ],
    scores: {
      overall: {
        label: "Security posture (headers + TLS + cookies)",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      securityHeaders: {
        label: "Security headers",
        value: typeof headerScore === "number" ? headerScore : "—",
        status: scoreFromProxy(headerScore),
      },
      tls: {
        label: "TLS certificate",
        value:
          typeof tls?.daysRemaining === "number"
            ? `${tls.daysRemaining}d remaining`
            : tlsSeverity || "—",
        status:
          tlsSeverity === "fail"
            ? "poor"
            : tlsSeverity === "warn"
              ? "needs_improvement"
              : tlsSeverity === "pass"
                ? "good"
                : "unknown",
      },
      cookies: {
        label: "Cookie flags",
        value: typeof cookieScore === "number" ? cookieScore : "—",
        status: scoreFromProxy(cookieScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      securityHeaders: { data: headers },
      tls: { data: tls },
      cookies: { data: cookies },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "TLS check is client-visible certificate inspection — not a full SSL Labs grade.",
      "Cookie analysis only sees Set-Cookie on the fetched response (try app/login URLs).",
      "Does not replace penetration testing or dependency scanning.",
    ],
  };
}

export function synthesizeSecurityHeaders(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const headers = unwrapToolPayload(stepResults.headers);
  const findings = findingsFromSecurityPayload(headers, "securityHeaders");
  const headerScore = scoreFromPayload(headers);
  const prioritizedActions = rankActions(findings, 10);
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;

  const gapLine =
    high > 0
      ? `${high} high-severity header gap${high === 1 ? "" : "s"} need attention.`
      : medium > 0
        ? `${medium} medium-severity header warning${medium === 1 ? "" : "s"} to tighten.`
        : findings.length === 0
          ? "No header gaps detected in this pass."
          : `${findings.length} header issue${findings.length === 1 ? "" : "s"} to review.`;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Security headers check for ${url}.` : "Security headers check complete.",
      typeof headerScore === "number"
        ? `Headers score ${headerScore}/100${headers?.grade ? ` (grade ${String(headers.grade)})` : ""}.`
        : gapLine,
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : high + medium === 0
          ? "Headers look acceptable for this pass."
          : gapLine,
    ],
    scores: {
      overall: {
        label: "Security headers score",
        value: typeof headerScore === "number" ? headerScore : "—",
        status: scoreFromProxy(headerScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: { securityHeaders: { data: headers } },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Single-URL response headers only — CDN/edge may differ by path.",
    ],
  };
}
