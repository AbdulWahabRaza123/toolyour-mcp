import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import {
  applyResponseMode,
  parseResponseMode,
  type ResponseMode,
} from "../orchestrator/compact-response";
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

/**
 * Accept an async job: return runId immediately and execute work in the background.
 * Webhook delivery is optional best-effort and never blocks or fails the run.
 */
export async function acceptAsyncJob(opts: {
  kind: StoredRun["kind"];
  apiKey: string;
  logger: Logger;
  responseMode?: ResponseMode | string;
  work: () => Promise<unknown>;
}): Promise<AsyncAcceptResponse> {
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
      // Fire-and-forget: webhook must never affect stored result
      if (finished) {
        void notifyJobFinishedOptional(opts.apiKey, finished, opts.logger);
      }
    } catch (e) {
      const err = {
        message: e instanceof Error ? e.message : String(e),
        code: (e as { code?: string })?.code,
      };
      const finished = runStore.finish(run.id, "error", null, err);
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
