import type {
  JobFinding,
  JobReport,
  JobScore,
  PrioritizedAction,
} from "../jobs/types";

export type VerifyGate = "pass" | "fail" | "unknown";

/** Where the host agent should apply the fix (it owns editor/git). */
export type RemainingFixPatchType =
  | "http-header"
  | "html"
  | "file"
  | "config"
  | "content"
  | "investigate";

export interface RemainingFix {
  rank: number;
  workstream: string;
  severity?: JobFinding["severity"];
  title: string;
  actions: string[];
  expectedImpact?: PrioritizedAction["expectedImpact"];
  source: "finding" | "prioritizedAction";
  /** Hint for the host agent — ToolYour does not patch the repo. */
  patchType: RemainingFixPatchType;
  /** What verify_task should see after the host applies this fix. */
  acceptance: string;
}

export interface VerifyNextAction {
  id: string;
  label: string;
  workstream?: string;
  severity?: JobFinding["severity"];
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

function acceptanceLine(title: string): string {
  return `After the host applies this fix, verify_task should no longer list "${title}" as a high finding (or the related score should leave poor).`;
}

/**
 * Build remainingFixes from the fresh jobReport (findings + prioritizedActions).
 */
export function buildRemainingFixes(after: JobReport | null): RemainingFix[] {
  if (!after) return [];
  const fixes: RemainingFix[] = [];
  let rank = 1;

  for (const f of sortFindings(after.findings || [])) {
    if (!findingNeedsHostFix(f, after.scores || {})) continue;
    const actions = (f.howToFix || [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (!actions.length && f.severity === "low") continue;
    const workstream = f.workstream || f.metric || "general";
    const title = f.title;
    fixes.push({
      rank: rank++,
      workstream,
      severity: f.severity,
      title,
      actions: actions.length
        ? actions
        : [
            "Investigate and remediate this finding, then re-run verify_task.",
          ],
      source: "finding",
      patchType: inferPatchType(workstream, title, f.metric),
      acceptance: acceptanceLine(title),
    });
  }

  const covered = new Set(fixes.map((x) => x.title.toLowerCase()));
  for (const a of after.prioritizedActions || []) {
    const key = String(a.action || "").toLowerCase();
    if (!key || covered.has(key)) continue;
    if (fixes.some((f) => f.actions.some((x) => x.toLowerCase() === key))) {
      continue;
    }
    const workstream = a.workstream || "general";
    if (
      after.scores?.[workstream]?.status === "good" &&
      a.expectedImpact === "low"
    ) {
      continue;
    }
    const title = a.action;
    fixes.push({
      rank: rank++,
      workstream,
      title,
      actions: [a.action],
      expectedImpact: a.expectedImpact,
      source: "prioritizedAction",
      patchType: inferPatchType(workstream, title),
      acceptance: acceptanceLine(title),
    });
  }

  return fixes.slice(0, 12);
}

export function buildNextActions(fixes: RemainingFix[]): VerifyNextAction[] {
  return fixes.slice(0, 5).map((f, i) => ({
    id: `fix_${i + 1}`,
    label: f.actions[0] || f.title,
    workstream: f.workstream,
    severity: f.severity,
  }));
}

export function computeVerifyGate(after: JobReport | null): VerifyGate {
  if (!after) return "unknown";
  const high = (after.findings || []).some((f) => f.severity === "high");
  const poor = Object.values(after.scores || {}).some(
    (s) => s.status === "poor"
  );
  if (high || poor) return "fail";
  return "pass";
}

/**
 * Peel common agent envelopes to a JobReport.
 */
export function extractJobReport(payload: unknown): JobReport | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.schemaVersion === "toolyour.jobReport@1") {
    return root as unknown as JobReport;
  }
  if (root.jobReport && typeof root.jobReport === "object") {
    return root.jobReport as JobReport;
  }
  if (
    root.execution &&
    typeof root.execution === "object" &&
    (root.execution as Record<string, unknown>).jobReport
  ) {
    return (root.execution as Record<string, unknown>).jobReport as JobReport;
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
