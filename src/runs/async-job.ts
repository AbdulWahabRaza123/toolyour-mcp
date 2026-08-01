import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import { applyResponseMode, parseResponseMode, type ResponseMode } from "../orchestrator/compact-response";
import { buildRunPath, runStore, type StoredRun } from "./store";
import { deliverJobFinishedWebhook, fetchJobWebhookConfig } from "./webhook";

export function wantsAsync(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export interface AsyncAcceptResponse {
  status: "accepted";
  runId: string;
  pollPath: string;
  kind: StoredRun["kind"];
  message: string;
}

/**
 * Accept an async job: return runId immediately and execute work in the background.
 */
export async function acceptAsyncJob(opts: {
  kind: StoredRun["kind"];
  apiKey: string;
  logger: Logger;
  responseMode?: ResponseMode | string;
  work: () => Promise<unknown>;
}): Promise<AsyncAcceptResponse> {
  // Resolve userId/apiKeyId via a lightweight validate (catalog path ok for meta)
  const session = await validateApiKey(opts.apiKey, "", "node", opts.logger);

  const run = runStore.create({
    userId: session.userId,
    apiKeyId: session.apiKeyId,
    kind: opts.kind,
  });

  const mode = parseResponseMode(opts.responseMode);

  void (async () => {
    runStore.markRunning(run.id);
    try {
      const raw = await opts.work();
      const shaped =
        raw && typeof raw === "object"
          ? applyResponseMode(raw as Record<string, unknown>, mode)
          : raw;
      const status =
        shaped &&
        typeof shaped === "object" &&
        ((shaped as { status?: string }).status === "partial" ||
          (shaped as { status?: string }).status === "error")
          ? ((shaped as { status: string }).status as "partial" | "error")
          : "completed";
      const finished = runStore.finish(run.id, status, shaped);
      if (finished) {
        const wh = await fetchJobWebhookConfig(opts.apiKey, opts.logger);
        if (wh) {
          void deliverJobFinishedWebhook(wh, finished, opts.logger);
        }
      }
    } catch (e) {
      const err = {
        message: e instanceof Error ? e.message : String(e),
        code: (e as { code?: string })?.code,
      };
      const finished = runStore.finish(run.id, "error", null, err);
      if (finished) {
        const wh = await fetchJobWebhookConfig(opts.apiKey, opts.logger);
        if (wh) {
          void deliverJobFinishedWebhook(wh, finished, opts.logger);
        }
      }
    }
  })();

  return {
    status: "accepted",
    runId: run.id,
    pollPath: buildRunPath(run.id),
    kind: opts.kind,
    message:
      "Job accepted. Poll get_run / GET pollPath, or wait for mcp.job.finished webhook if configured.",
  };
}
