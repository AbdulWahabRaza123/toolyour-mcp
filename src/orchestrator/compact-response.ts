import { payloadStore, buildDataRefPath } from "../payloads/store";

export type ResponseMode = "compact" | "full" | "dataRef";

export function parseResponseMode(raw: unknown): ResponseMode {
  const v = String(raw || "compact").toLowerCase();
  if (v === "full" || v === "dataref" || v === "data_ref") {
    return v === "full" ? "full" : "dataRef";
  }
  return "compact";
}

function slimJobReport(
  jobReport: Record<string, unknown>,
  mode: ResponseMode
): Record<string, unknown> {
  const jr = { ...jobReport };
  if (mode === "full") return jr;

  delete jr.steps;
  if (jr.workstreams && typeof jr.workstreams === "object") {
    const slim: Record<string, unknown> = {};
    for (const key of Object.keys(jr.workstreams as object)) {
      slim[key] = { present: true };
    }
    jr.workstreams = slim;
  }
  return jr;
}

function compactExecution(
  execution: Record<string, unknown>,
  mode: ResponseMode
): Record<string, unknown> {
  const exec = { ...execution };

  if (exec.jobReport && typeof exec.jobReport === "object") {
    const fullReport = exec.jobReport as Record<string, unknown>;
    if (mode === "dataRef") {
      const stored = payloadStore.store(
        String(fullReport.workflowId || fullReport.jobId || "jobReport"),
        {
          ...exec,
          jobReport: fullReport,
        }
      );
      exec.jobReport = slimJobReport(fullReport, "compact");
      exec.dataRefId = stored.id;
      exec.dataRef = buildDataRefPath(stored.id);
      exec.dataRefExpiresAt = new Date(stored.expiresAt).toISOString();
      exec.hint =
        "Full execution stored — use fetch_payload(dataRefId) for steps/workstreams.";
    } else if (mode === "compact") {
      exec.jobReport = slimJobReport(fullReport, "compact");
    }
    // Drop duplicates of jobReport content
    delete exec.steps;
    delete exec.result;
    delete exec.partialResult;
  } else if (mode === "compact" && exec.mode === "content-bridge") {
    // Keep local summaries; drop bulky backend shaped blobs beyond status
    if (Array.isArray(exec.backend)) {
      exec.backend = (exec.backend as Array<Record<string, unknown>>).map(
        (b) => ({
          operationId: b.operationId,
          httpStatus: b.httpStatus,
          note: "Set responseMode=full for raw tool payloads",
        })
      );
    }
  } else if (mode === "dataRef" && exec.result) {
    const stored = payloadStore.store(
      String(exec.operationId || "tool"),
      exec.result
    );
    exec.result = {
      summarized: true,
      dataRefId: stored.id,
      dataRef: buildDataRefPath(stored.id),
      dataRefExpiresAt: new Date(stored.expiresAt).toISOString(),
    };
  }

  exec.compact = mode !== "full";
  return exec;
}

/**
 * Default compact: one jobReport (or content-bridge summary), no duplicated steps.
 * full: unchanged. dataRef: compact + TTL store of full payload.
 */
export function applyResponseMode(
  result: unknown,
  mode: ResponseMode = "compact"
): unknown {
  if (!result || typeof result !== "object") return result;
  const root = { ...(result as Record<string, unknown>) };

  if (mode === "full") {
    root.responseMode = "full";
    return root;
  }

  if (root.execution && typeof root.execution === "object") {
    root.execution = compactExecution(
      root.execution as Record<string, unknown>,
      mode
    );
  } else if (root.jobReport && typeof root.jobReport === "object") {
    // Direct workflow-shaped payload
    const full = root as Record<string, unknown>;
    if (mode === "dataRef") {
      const stored = payloadStore.store(
        String(
          (root.jobReport as Record<string, unknown>).workflowId || "workflow"
        ),
        full
      );
      root.jobReport = slimJobReport(
        root.jobReport as Record<string, unknown>,
        "compact"
      );
      delete root.steps;
      delete root.result;
      delete root.partialResult;
      root.dataRefId = stored.id;
      root.dataRef = buildDataRefPath(stored.id);
    } else {
      root.jobReport = slimJobReport(
        root.jobReport as Record<string, unknown>,
        "compact"
      );
      delete root.steps;
      delete root.result;
      delete root.partialResult;
    }
  }

  root.responseMode = mode;
  return root;
}
