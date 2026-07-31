import { constants } from "../config";
import { incr } from "../observability/counters";
import { buildDataRefPath, payloadStore } from "../payloads/store";

function isToolFileResponse(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return (
    o.status === 200 &&
    typeof o.result === "object" &&
    o.result !== null &&
    typeof (o.result as Record<string, unknown>).downloadUrl === "string"
  );
}

function isJobReport(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return (
    o.schemaVersion === "toolyour.jobReport@1" ||
    (typeof o.jobId === "string" &&
      Array.isArray(o.findings) &&
      Array.isArray(o.prioritizedActions))
  );
}

const JOB_PRESERVE_KEYS = new Set([
  "schemaVersion",
  "jobId",
  "workflowId",
  "url",
  "summary",
  "scores",
  "findings",
  "prioritizedActions",
  "toolsUsed",
  "limitations",
]);

/**
 * Structure-aware truncation: keep JobReport action fields intact;
 * shrink nested evidence / steps / workstreams last.
 */
function structureAwareTruncate(
  data: unknown,
  maxBytes: number
): { data: unknown; dropped: string[] } {
  const text = JSON.stringify(data);
  if (text.length <= maxBytes) return { data, dropped: [] };

  const dropped: string[] = [];

  if (isJobReport(data)) {
    const report = { ...(data as Record<string, unknown>) };
    if (Array.isArray(report.findings) && report.findings.length > 25) {
      dropped.push(`findings:${report.findings.length - 25}`);
      report.findings = report.findings.slice(0, 25);
    }
    if (
      Array.isArray(report.prioritizedActions) &&
      report.prioritizedActions.length > 12
    ) {
      dropped.push(
        `prioritizedActions:${report.prioritizedActions.length - 12}`
      );
      report.prioritizedActions = report.prioritizedActions.slice(0, 12);
    }
    if (report.steps) {
      dropped.push("steps");
      delete report.steps;
    }
    if (report.workstreams) {
      const ws = report.workstreams as Record<string, unknown>;
      const slim: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ws)) {
        if (v && typeof v === "object") {
          const obj = v as Record<string, unknown>;
          slim[k] = {
            keys: Object.keys(obj),
            note: "Full workstream omitted for context size",
          };
        } else {
          slim[k] = v;
        }
      }
      dropped.push("workstreams.detail");
      report.workstreams = slim;
    }

    const after = JSON.stringify(report);
    if (after.length <= maxBytes) return { data: report, dropped };

    const minimal: Record<string, unknown> = {};
    for (const key of JOB_PRESERVE_KEYS) {
      if (key in report) minimal[key] = report[key];
    }
    dropped.push("non-core-fields");
    return { data: minimal, dropped };
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = { ...(data as Record<string, unknown>) };
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length > 20) {
        dropped.push(`${k}:${v.length - 20}`);
        obj[k] = v.slice(0, 20);
      }
    }
    const after = JSON.stringify(obj);
    if (after.length <= maxBytes) return { data: obj, dropped };
  }

  return {
    data: {
      summary: "Response truncated for LLM context",
      preview: text.slice(0, maxBytes),
      truncated: true,
      originalBytes: text.length,
    },
    dropped: ["raw-preview"],
  };
}

export function shapeResponseForLlm(
  operationId: string,
  status: number,
  data: unknown,
  text: string
): unknown {
  if (status < 200 || status >= 300) {
    return {
      status,
      error: typeof data === "object" ? data : { message: text.slice(0, 500) },
    };
  }

  if (isToolFileResponse(data)) {
    const envelope = data as { status: number; result: Record<string, unknown> };
    return {
      status: 200,
      type: "file",
      fileName: envelope.result.fileName,
      mimeType: envelope.result.mimeType,
      downloadUrl: envelope.result.downloadUrl,
      expiresAt: envelope.result.expiresAt,
      hint: "Download via downloadUrl; do not request raw bytes in context",
    };
  }

  const bytes = text.length;
  if (bytes <= constants.summarizeThresholdBytes) {
    return { status: 200, operationId, data };
  }

  incr("truncations");
  const stored = payloadStore.store(operationId, data);
  const { data: trimmed, dropped } = structureAwareTruncate(
    data,
    constants.summarizedMaxBytes
  );

  return {
    status: 200,
    operationId,
    data: trimmed,
    dataRef: buildDataRefPath(stored.id),
    dataRefId: stored.id,
    dataRefExpiresAt: new Date(stored.expiresAt).toISOString(),
    summarized: true,
    droppedFields: dropped,
    originalBytes: bytes,
    hint: "Full payload available via fetch_payload(dataRefId) or GET dataRef with X-Api-Key (in-process TTL store, free).",
  };
}
