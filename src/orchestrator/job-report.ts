import type {
  JobFinding,
  JobReport,
  JobScore,
  PrioritizedAction,
} from "../jobs/types";
import { stampFindingIds } from "../jobs/utils";

/** Ship-gate critical workstreams — NI/unknown here fails the gate (speed proxy excluded). */
export const SHIP_CRITICAL_SCORE_KEYS = [
  "tls",
  "securityHeaders",
  "httpStatus",
  "mixedContent",
] as const;

/** Detail metrics — unknown alone must not fail default audits. */
const OPTIONAL_METRIC_SCORE_KEYS = new Set([
  "LCP",
  "CLS",
  "INP",
  "TTFB",
  "FCP",
]);

export type VerifyGate = "pass" | "fail" | "unknown";

/** Where the host agent should apply the fix (it owns editor/git). */
export type RemainingFixPatchType =
  | "http-header"
  | "html"
  | "file"
  | "config"
  | "content"
  | "investigate";

/** Advice only: where the host should focus (not a Cursor Task type). */
export type RemainingFixRoleHint = "edit" | "config" | "read" | "shell";

export interface RemainingFix {
  rank: number;
  findingId?: string;
  workstream: string;
  severity?: JobFinding["severity"];
  title: string;
  actions: string[];
  expectedImpact?: PrioritizedAction["expectedImpact"];
  source: "finding" | "prioritizedAction";
  /** Hint for the host agent — ToolYour does not patch the repo. */
  patchType: RemainingFixPatchType;
  /** Advice only: where the host should focus (not a Cursor Task type). */
  roleHint: RemainingFixRoleHint;
  /** What verify_task should see after the host applies this fix. */
  acceptance: string;
}

export interface VerifyNextAction {
  id: string;
  findingId?: string;
  label: string;
  workstream?: string;
  severity?: JobFinding["severity"];
  patchType?: RemainingFixPatchType;
  roleHint?: RemainingFixRoleHint;
  acceptance?: string;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: JobFinding[]): JobFinding[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
  );
}

export function inferPatchType(
  workstream: string,
  title: string,
  metric?: string
): RemainingFixPatchType {
  const blob = `${workstream} ${title} ${metric || ""}`.toLowerCase();
  if (
    /header|csp|hsts|cors|cookie|tls|ssl|x-frame|x-content|referrer|permissions-policy|hpkp/.test(
      blob
    )
  ) {
    return "http-header";
  }
  if (/secret|token|jwt|api[_ -]?key|\.env|credential/.test(blob)) {
    return "config";
  }
  if (/lcp|cls|inp|tbt|cwv|speed|asset|image|font|compress|defer|preload/.test(blob)) {
    return "file";
  }
  if (
    /html|h1|heading|meta|title|schema|json-ld|og:|open graph|twitter card|canonical|alt text|content/.test(
      blob
    )
  ) {
    return "html";
  }
  if (/copy|subject|utm|cta|landing/.test(blob)) {
    return "content";
  }
  return "investigate";
}

function findingNeedsHostFix(
  f: JobFinding,
  scores: Record<string, JobScore>
): boolean {
  const ev = f.evidence || {};
  const evSev = String(ev.severity || "").toLowerCase();
  if (evSev === "pass" || evSev === "ok" || evSev === "good") return false;

  const title = String(f.title || "").toLowerCase();
  if (
    /^no\s/.test(title) &&
    /issue|problem|mixed-content|mixed content/.test(title)
  ) {
    return false;
  }

  const ws = f.workstream;
  if (ws && scores[ws]?.status === "good" && f.severity === "low") {
    return false;
  }

  return true;
}

export function inferRoleHint(
  patchType: RemainingFixPatchType
): RemainingFixRoleHint {
  if (patchType === "http-header" || patchType === "config") return "config";
  if (patchType === "investigate") return "read";
  if (patchType === "file") return "edit";
  return "edit";
}

function acceptanceLine(
  title: string,
  patchType: RemainingFixPatchType
): string {
  const where =
    patchType === "http-header"
      ? "server/CDN response headers (or framework security headers)"
      : patchType === "config"
        ? "env/config (rotate or remove secrets; never commit them)"
        : patchType === "html" || patchType === "content"
          ? "HTML/templates/CMS content"
          : patchType === "file"
            ? "repo assets or frontend build pipeline"
            : "the relevant host workspace files";
  return `Done when: after changing ${where}, verify_task no longer lists "${title}" as an open high finding (and related ship-critical scores are not poor/needs_improvement/unknown).`;
}

/**
 * Build remainingFixes from the fresh jobReport (findings + prioritizedActions).
 */
export function buildRemainingFixes(after: JobReport | null): RemainingFix[] {
  if (!after) return [];
  const stamped = {
    ...after,
    findings: stampFindingIds(after.findings),
  };
  const fixes: RemainingFix[] = [];
  let rank = 1;

  for (const f of sortFindings(stamped.findings || [])) {
    if (!findingNeedsHostFix(f, stamped.scores || {})) continue;
    const actions = (f.howToFix || [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (!actions.length && f.severity === "low") continue;
    const workstream = f.workstream || f.metric || "general";
    const title = f.title;
    const patchType = inferPatchType(workstream, title, f.metric);
    fixes.push({
      rank: rank++,
      findingId: f.findingId,
      workstream,
      severity: f.severity,
      title,
      actions: actions.length
        ? actions
        : [
            "Investigate and remediate this finding, then re-run verify_task.",
          ],
      source: "finding",
      patchType,
      roleHint: inferRoleHint(patchType),
      acceptance: acceptanceLine(title, patchType),
    });
  }

  const covered = new Set(fixes.map((x) => x.title.toLowerCase()));
  for (const a of stamped.prioritizedActions || []) {
    const key = String(a.action || "").toLowerCase();
    if (!key || covered.has(key)) continue;
    if (fixes.some((f) => f.actions.some((x) => x.toLowerCase() === key))) {
      continue;
    }
    const workstream = a.workstream || "general";
    if (
      stamped.scores?.[workstream]?.status === "good" &&
      a.expectedImpact === "low"
    ) {
      continue;
    }
    const title = a.action;
    const patchType = inferPatchType(workstream, title);
    fixes.push({
      rank: rank++,
      workstream,
      title,
      actions: [a.action],
      expectedImpact: a.expectedImpact,
      source: "prioritizedAction",
      patchType,
      roleHint: inferRoleHint(patchType),
      acceptance: acceptanceLine(title, patchType),
    });
  }

  return fixes.slice(0, 12);
}

/** Rank-1 only — full fix list stays on remainingFixes. */
export function buildNextActions(fixes: RemainingFix[]): VerifyNextAction[] {
  return fixes.slice(0, 1).map((f) => ({
    id: f.findingId || `fix_${f.rank}`,
    findingId: f.findingId,
    label: f.actions[0] || f.title,
    workstream: f.workstream,
    severity: f.severity,
    patchType: f.patchType,
    roleHint: f.roleHint,
    acceptance: f.acceptance,
  }));
}

export function computeVerifyGate(after: JobReport | null): VerifyGate {
  if (!after) return "unknown";
  if (after.incomplete) return "fail";
  const high = (after.findings || []).some((f) => f.severity === "high");
  const scoreValues = Object.values(after.scores || {});
  const poor = scoreValues.some((s) => s.status === "poor");
  if (high || poor) return "fail";

  // Empty/unknown scorecards (typical of failed first step) are not a pass.
  if (
    scoreValues.length > 0 &&
    scoreValues.every((s) => s.status === "unknown")
  ) {
    return "unknown";
  }

  // Primary workstream scores (not LCP/CLS/…) must be known to pass.
  const primaryUnknown = Object.entries(after.scores || {}).some(([key, s]) => {
    if (key === "overall") return false;
    if (OPTIONAL_METRIC_SCORE_KEYS.has(key)) return false;
    return s.status === "unknown";
  });
  if (primaryUnknown) return "fail";

  // Secrets hygiene: any open secret/jwt finding or NI overall fails.
  if (after.gatePolicy === "secrets") {
    const openSecret = (after.findings || []).some(
      (f) => f.workstream === "secrets" || f.workstream === "jwt"
    );
    if (openSecret) return "fail";
    const overall = after.scores?.overall?.status;
    if (overall === "needs_improvement" || overall === "poor") return "fail";
  }

  // Ship policy: critical deploy signals must be good (not NI/unknown).
  // Page-speed proxy stays on default rules only (poor already failed above).
  if (after.gatePolicy === "ship") {
    for (const key of SHIP_CRITICAL_SCORE_KEYS) {
      const st = after.scores?.[key]?.status;
      if (
        !st ||
        st === "unknown" ||
        st === "needs_improvement" ||
        st === "poor"
      ) {
        return "fail";
      }
    }
  }

  return "pass";
}

/**
 * Peel common agent envelopes to a JobReport.
 */
function withStampedFindings(report: JobReport): JobReport {
  return {
    ...report,
    findings: stampFindingIds(report.findings),
  };
}

export function extractJobReport(payload: unknown): JobReport | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.schemaVersion === "toolyour.jobReport@1") {
    return withStampedFindings(root as unknown as JobReport);
  }
  if (root.jobReport && typeof root.jobReport === "object") {
    return withStampedFindings(root.jobReport as JobReport);
  }
  if (
    root.execution &&
    typeof root.execution === "object" &&
    (root.execution as Record<string, unknown>).jobReport
  ) {
    return withStampedFindings(
      (root.execution as Record<string, unknown>).jobReport as JobReport
    );
  }
  if (root.after !== undefined) {
    const nested = extractJobReport(root.after);
    if (nested) return nested;
  }
  if (root.result !== undefined) {
    const nested = extractJobReport(root.result);
    if (nested) return nested;
  }
  return null;
}
