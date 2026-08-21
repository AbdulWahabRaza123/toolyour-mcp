import type {
  JobFinding,
  JobImpact,
  JobMetricStatus,
  JobReport,
  JobScore,
  PrioritizedAction,
} from "./types";

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
  const body = resolveToolResultBody(shaped);
  if (!body) return undefined;
  if (typeof body.url === "string") return body.url;
  const inner = body.data;
  if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).url === "string") {
    return (inner as Record<string, unknown>).url as string;
  }
  return undefined;
}

/**
 * Peel MCP shaped invoke `{ status: 200, data }` down to the tool result core.
 * Handles both:
 * - Direct toolResult: `{ schemaVersion, data, report }`
 * - Gateway envelope: `{ status: true, code, result: toolResult|flatPayload }`
 */
export function resolveToolResultBody(shaped: unknown): Record<string, unknown> | null {
  if (!shaped || typeof shaped !== "object") return null;
  const root = shaped as Record<string, unknown>;
  if (root.status !== 200) return null;
  const data = root.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  let body = data as Record<string, unknown>;

  const looksLikeGatewayEnvelope =
    "result" in body &&
    body.result !== null &&
    typeof body.result === "object" &&
    !Array.isArray(body.result) &&
    (typeof body.status === "boolean" ||
      typeof body.code === "number" ||
      "error" in body ||
      "message" in body);

  if (looksLikeGatewayEnvelope) {
    body = body.result as Record<string, unknown>;
  }
  return body;
}

/** Normalized tool result body from shaped MCP invoke response. */
export function unwrapToolPayload(shaped: unknown): Record<string, unknown> | null {
  const body = resolveToolResultBody(shaped);
  if (!body) return null;
  // toolyour.toolResult@1 — domain fields live under .data
  if (
    body.data &&
    typeof body.data === "object" &&
    !Array.isArray(body.data) &&
    (body.report ||
      body.schemaVersion === "toolyour.toolResult@1" ||
      typeof body.toolId === "string")
  ) {
    return body.data as Record<string, unknown>;
  }
  return body;
}

export function extractReport(shaped: unknown): Record<string, unknown> | null {
  const body = resolveToolResultBody(shaped);
  if (!body) return null;
  const report = body.report;
  if (report && typeof report === "object" && !Array.isArray(report)) {
    return report as Record<string, unknown>;
  }
  return null;
}

export function scoreFromProxy(proxyScore: unknown, good = 80, ok = 60): JobMetricStatus {
  if (typeof proxyScore !== "number" || Number.isNaN(proxyScore)) return "unknown";
  if (proxyScore >= good) return "good";
  if (proxyScore >= ok) return "needs_improvement";
  return "poor";
}

const STATUS_RANK: Record<JobMetricStatus, number> = {
  poor: 0,
  needs_improvement: 1,
  unknown: 2,
  good: 3,
};

/** Worst status wins — overall must never look better than a critical score. */
export function worstMetricStatus(
  statuses: Array<JobMetricStatus | undefined>
): JobMetricStatus {
  let worst: JobMetricStatus = "good";
  for (const st of statuses) {
    if (!st) continue;
    if (STATUS_RANK[st] < STATUS_RANK[worst]) worst = st;
  }
  return worst;
}

export function capOverallBySiblingScores(
  scores: Record<string, JobScore>
): Record<string, JobScore> {
  const overall = scores.overall;
  if (!overall) return scores;
  const siblings = Object.entries(scores)
    .filter(([k]) => k !== "overall")
    .map(([, s]) => s.status);
  if (siblings.length === 0) return scores;
  const capped = worstMetricStatus([overall.status, ...siblings]);
  if (capped === overall.status) return scores;
  return {
    ...scores,
    overall: { ...overall, status: capped },
  };
}

/**
 * Incomplete runs must not read as a clean bill of health.
 */
export function markIncompleteJobReport(
  report: JobReport,
  reason = "One or more workflow steps failed or were skipped."
): JobReport {
  const banner = `INCOMPLETE: ${reason} Do not treat as ship-ready or gate pass.`;
  const summary = [banner, ...(report.summary || []).filter((s) => !/^INCOMPLETE:/i.test(s))];
  const scores = { ...report.scores };
  for (const [key, score] of Object.entries(scores)) {
    if (score.status === "good") {
      scores[key] = { ...score, status: "unknown" };
    }
  }
  if (scores.overall) {
    scores.overall = {
      ...scores.overall,
      status: "unknown",
      value:
        typeof scores.overall.value === "number"
          ? scores.overall.value
          : scores.overall.value,
    };
  }
  const limitations = [
    "This report is incomplete — missing or failed steps were not scored.",
    ...(report.limitations || []),
  ];
  return {
    ...report,
    incomplete: true,
    summary,
    scores: capOverallBySiblingScores(scores),
    limitations,
  };
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
      const title = String(item.title ?? "Finding");
      const resolvedMetric = metric || (typeof item.metric === "string" ? item.metric : undefined);
      return {
        workstream,
        metric: resolvedMetric,
        severity: (item.severity as JobFinding["severity"]) || "medium",
        title,
        whyItMatters: String(item.whyItMatters ?? ""),
        howToFix: Array.isArray(item.howToFix) ? item.howToFix.map(String) : [],
        evidence:
          item.evidence && typeof item.evidence === "object"
            ? (item.evidence as Record<string, unknown>)
            : undefined,
      };
    });
}

export function stableFindingId(
  workstream: string | undefined,
  title: string,
  metric?: string
): string {
  const raw = [workstream || "general", metric || "", title]
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return raw || "finding";
}

export function stampFindingIds(findings: JobFinding[] | undefined): JobFinding[] {
  return (findings || []).map((f) => ({
    ...f,
    findingId: f.findingId || stableFindingId(f.workstream, f.title, f.metric),
  }));
}

export const PROXY_SPEED_LIMITATIONS = [
  "LCP/CLS/INP scores are HTML-based proxies, not Chrome field CrUX or Lighthouse lab metrics.",
  "INP is approximated via Total Blocking Time (TBT) when labeled as a proxy.",
  "TTFB prefers Server-Timing when present; otherwise uses fetch timing to first HTML response (not a Chrome trace).",
  "assetOptimizer lists are heuristic (image sizes + HTML attributes), not Lighthouse audits.",
] as const;

export function finalizeJobReport(report: JobReport): JobReport {
  const findings = stampFindingIds(report.findings);
  const usesSpeed = (report.toolsUsed || []).includes("pageSpeedAnalyzer");
  let limitations = [...(report.limitations || [])];
  if (usesSpeed) {
    for (const line of PROXY_SPEED_LIMITATIONS) {
      if (!limitations.includes(line)) limitations.push(line);
    }
  }
  const scores = capOverallBySiblingScores(report.scores || {});
  return {
    ...report,
    findings,
    scores,
    gatePolicy: report.gatePolicy,
    limitations: limitations.length ? limitations : report.limitations,
  };
}

export function mergeFindings(...groups: JobFinding[][]): JobFinding[] {
  const seen = new Set<string>();
  const out: JobFinding[] = [];
  for (const group of groups) {
    for (const f of group) {
      const key = f.findingId || `${f.workstream}|${f.title}`.toLowerCase();
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

/** Pull page-speed evidence.assetOptimizer for agents / jobReports. */
export function extractAssetOptimizer(
  speedReport: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!speedReport?.evidence || typeof speedReport.evidence !== "object") return null;
  const evidence = speedReport.evidence as Record<string, unknown>;
  const ao = evidence.assetOptimizer;
  if (!ao || typeof ao !== "object") return null;
  return ao as Record<string, unknown>;
}

/**
 * Prioritized actions from pageSpeedAnalyzer evidence.assetOptimizer.
 * High impact for LCP compress + render-blocking defer.
 */
export function assetActionsFromSpeedReport(
  speedReport: Record<string, unknown> | null,
  limit = 8
): PrioritizedAction[] {
  const ao = extractAssetOptimizer(speedReport);
  if (!ao) return [];
  const actions: PrioritizedAction[] = [];

  const compress = Array.isArray(ao.compressImages) ? ao.compressImages : [];
  for (const item of compress) {
    if (actions.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const src = String(row.src || "").trim();
    if (!src) continue;
    const reason = String(row.reason || "Compress / resize image");
    actions.push({
      rank: actions.length + 1,
      workstream: "assets",
      action: `Compress or resize image: ${src} (${reason})`,
      expectedImpact: /lcp/i.test(reason) ? "high" : "medium",
      effort: "medium",
    });
  }

  const defer = Array.isArray(ao.deferScripts) ? ao.deferScripts : [];
  for (const item of defer) {
    if (actions.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const src = String(row.src || "").trim();
    if (!src) continue;
    actions.push({
      rank: actions.length + 1,
      workstream: "assets",
      action: `Defer or async script: ${src}`,
      expectedImpact: "high",
      effort: "low",
    });
  }

  const dims = Array.isArray(ao.fixDimensions) ? ao.fixDimensions : [];
  for (const srcRaw of dims) {
    if (actions.length >= limit) break;
    const src = String(srcRaw || "").trim();
    if (!src) continue;
    actions.push({
      rank: actions.length + 1,
      workstream: "assets",
      action: `Add width/height attributes for CLS: ${src}`,
      expectedImpact: "medium",
      effort: "low",
    });
  }

  const preloads = Array.isArray(ao.preloadHints) ? ao.preloadHints : [];
  for (const item of preloads) {
    if (actions.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const href = String(row.href || "").trim();
    if (!href) continue;
    const as = String(row.as || "image");
    actions.push({
      rank: actions.length + 1,
      workstream: "assets",
      action: `Consider preload as=${as}: ${href}`,
      expectedImpact: as === "image" ? "high" : "medium",
      effort: "low",
    });
  }

  return actions.map((a, i) => ({ ...a, rank: i + 1 }));
}

export function mergePrioritizedActions(
  ...groups: PrioritizedAction[][]
): PrioritizedAction[] {
  const seen = new Set<string>();
  const out: PrioritizedAction[] = [];
  for (const group of groups) {
    for (const a of group) {
      const key = a.action.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out.map((a, i) => ({ ...a, rank: i + 1 }));
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
  const links = (fromReport.length > 0 ? fromReport : fromData)
    .slice()
    .sort((a, b) => {
      const ra = typeof a.relevanceScore === "number" ? a.relevanceScore : 0;
      const rb = typeof b.relevanceScore === "number" ? b.relevanceScore : 0;
      return rb - ra;
    })
    .slice(0, Math.min(cap, 10));
  return links.map((link, i) => ({
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
