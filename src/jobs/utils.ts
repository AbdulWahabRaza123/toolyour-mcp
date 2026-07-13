import type { JobFinding, JobImpact, JobMetricStatus, PrioritizedAction } from "./types";

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function extractUrl(input: Record<string, unknown>, stepResults: Record<string, unknown>): string | undefined {
  if (typeof input.url === "string" && input.url.trim()) return input.url.trim();
  for (const shaped of Object.values(stepResults)) {
    const url = extractUrlFromShaped(shaped);
    if (url) return url;
  }
  return undefined;
}

export function extractUrlFromShaped(shaped: unknown): string | undefined {
  if (!shaped || typeof shaped !== "object") return undefined;
  const root = shaped as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.url === "string") return d.url;
    const inner = d.data;
    if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).url === "string") {
      return (inner as Record<string, unknown>).url as string;
    }
  }
  return undefined;
}

/** Normalized tool result body from shaped MCP invoke response. */
export function unwrapToolPayload(shaped: unknown): Record<string, unknown> | null {
  if (!shaped || typeof shaped !== "object") return null;
  const root = shaped as Record<string, unknown>;
  if (root.status !== 200) return null;
  const data = root.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.data && typeof d.data === "object") return d.data as Record<string, unknown>;
  return d;
}

export function extractReport(shaped: unknown): Record<string, unknown> | null {
  if (!shaped || typeof shaped !== "object") return null;
  const root = shaped as Record<string, unknown>;
  if (root.status !== 200) return null;
  const data = root.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const report = d.report;
  if (report && typeof report === "object") return report as Record<string, unknown>;
  return null;
}

export function scoreFromProxy(proxyScore: unknown, good = 80, ok = 60): JobMetricStatus {
  if (typeof proxyScore !== "number" || Number.isNaN(proxyScore)) return "unknown";
  if (proxyScore >= good) return "good";
  if (proxyScore >= ok) return "needs_improvement";
  return "poor";
}

export function metricLabel(status: JobMetricStatus): string {
  if (status === "good") return "good";
  if (status === "needs_improvement") return "needs improvement";
  if (status === "poor") return "poor";
  return "unknown";
}

export function findingsFromReport(
  report: Record<string, unknown> | null,
  workstream: string,
  metric?: string
): JobFinding[] {
  if (!report) return [];
  const raw = report.findings;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === "object")
    .map((f) => {
      const item = f as Record<string, unknown>;
      return {
        workstream,
        metric,
        severity: (item.severity as JobFinding["severity"]) || "medium",
        title: String(item.title ?? "Finding"),
        whyItMatters: String(item.whyItMatters ?? ""),
        howToFix: Array.isArray(item.howToFix) ? item.howToFix.map(String) : [],
        evidence:
          item.evidence && typeof item.evidence === "object"
            ? (item.evidence as Record<string, unknown>)
            : undefined,
      };
    });
}

export function mergeFindings(...groups: JobFinding[][]): JobFinding[] {
  const seen = new Set<string>();
  const out: JobFinding[] = [];
  for (const group of groups) {
    for (const f of group) {
      const key = `${f.workstream}|${f.title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}

export function rankActions(findings: JobFinding[], cap = 10): PrioritizedAction[] {
  const actions: PrioritizedAction[] = [];
  let rank = 1;
  for (const f of findings) {
    const fix = f.howToFix[0];
    if (!fix) continue;
    actions.push({
      rank: rank++,
      workstream: f.workstream || f.metric || "general",
      action: fix,
      expectedImpact: f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low",
      effort: "medium",
    });
    if (actions.length >= cap) break;
  }
  return actions;
}

export function operationIdsFromSteps(steps: { operationId: string }[]): string[] {
  return [...new Set(steps.map((s) => s.operationId))];
}

export function prioritizedLinkSuggestionsFromShaped(
  shaped: unknown,
  cap = 15
): PrioritizedAction[] {
  const payload = unwrapToolPayload(shaped);
  if (!payload) return [];
  const report = extractReport(shaped);
  const fromReport =
    report?.evidence &&
    typeof report.evidence === "object" &&
    Array.isArray((report.evidence as Record<string, unknown>).prioritizedSuggestedLinks)
      ? ((report.evidence as Record<string, unknown>).prioritizedSuggestedLinks as Array<
          Record<string, unknown>
        >)
      : [];
  const fromData = Array.isArray(payload.suggestedLinks)
    ? (payload.suggestedLinks as Array<Record<string, unknown>>)
    : [];
  const links = fromReport.length > 0 ? fromReport : fromData;
  return links.slice(0, cap).map((link, i) => ({
    rank: i + 1,
    workstream: "internalLinking",
    action: `Add internal link from ${String(link.from)} → ${String(link.to)} with anchor "${String(link.suggestedAnchorText || "Learn more")}"`,
    expectedImpact: (link.relevanceScore as number) >= 70 ? "high" : "medium",
    effort: "low",
  }));
}

export function hubPagesFromShaped(shaped: unknown): Array<{ url: string; score: number; reason: string }> {
  const report = extractReport(shaped);
  const fromEvidence =
    report?.evidence &&
    typeof report.evidence === "object" &&
    Array.isArray((report.evidence as Record<string, unknown>).prioritizedHubPages)
      ? ((report.evidence as Record<string, unknown>).prioritizedHubPages as Array<{
          url: string;
          score: number;
          reason: string;
        }>)
      : [];
  if (fromEvidence.length) return fromEvidence;
  const payload = unwrapToolPayload(shaped);
  const graph = payload?.graph;
  if (graph && typeof graph === "object" && Array.isArray((graph as Record<string, unknown>).hubPages)) {
    return (graph as Record<string, unknown>).hubPages as Array<{
      url: string;
      score: number;
      reason: string;
    }>;
  }
  return [];
}
