import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import { buildRunPath, runStore, type StoredRun } from "./store";
import { notifyJobFinishedOptional } from "./webhook";

export function wantsAsync(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export interface AsyncAcceptResponse {
  status: "accepted";
  runId: string;
  pollPath: string;
  kind: StoredRun["kind"];
  /** Always true — primary completion path is get_run / pollPath */
  pollSupported: true;
  /** Informative only; webhook is optional and never required */
  webhookOptional: true;
  message: string;
}

function storeStatusFromResult(shaped: unknown): "completed" | "partial" | "error" {
  const st =
    shaped && typeof shaped === "object"
      ? String((shaped as { status?: string }).status || "")
      : "";
  if (st === "partial") return "partial";
  if (st === "error") return "error";
  // suggest / need_input / need_workflow / completed / verified → job finished successfully
  return "completed";
}

/**
 * Accept an async job: return runId immediately and execute work in the background.
 * Webhook delivery is optional best-effort and never blocks or fails the run.
 *
 * Callers must apply responseMode inside work() — this function does not reshape results
 * (re-applying dataRef would double-store and corrupt payloads).
 */
export async function acceptAsyncJob(opts: {
  kind: StoredRun["kind"];
  apiKey: string;
  logger: Logger;
  work: () => Promise<unknown>;
}): Promise<AsyncAcceptResponse> {
  const session = await validateApiKey(opts.apiKey, "", "node", opts.logger);

  const run = await runStore.create({
    userId: session.userId,
    apiKeyId: session.apiKeyId,
    kind: opts.kind,
  });

  void (async () => {
    await runStore.markRunning(run.id);
    try {
      const shaped = await opts.work();
      const finished = await runStore.finish(
        run.id,
        storeStatusFromResult(shaped),
        shaped
      );
      if (finished) {
        void notifyJobFinishedOptional(opts.apiKey, finished, opts.logger);
      }
    } catch (e) {
      const err = {
        message: e instanceof Error ? e.message : String(e),
        code: (e as { code?: string })?.code,
      };
      const finished = await runStore.finish(run.id, "error", null, err);
      if (finished) {
        void notifyJobFinishedOptional(opts.apiKey, finished, opts.logger);
      }
    }
  })();

  return {
    status: "accepted",
    runId: run.id,
    pollPath: buildRunPath(run.id),
    kind: opts.kind,
    pollSupported: true,
    webhookOptional: true,
    message:
      "Job accepted. Poll get_run (or GET pollPath) for the result — this always works. An mcp.job.finished webhook is optional and only sent if you configured one in the dashboard; webhook failures are ignored.",
  };
}
