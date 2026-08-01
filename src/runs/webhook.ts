import { createHmac } from "crypto";
import { getEnv } from "../config";
import type { Logger } from "../observability/logger";
import type { StoredRun } from "./store";

export interface JobWebhookConfig {
  url: string;
  secret: string;
}

export interface WebhookNotifyResult {
  attempted: boolean;
  delivered: boolean;
  skippedReason?: string;
}

/**
 * Load optional per-user webhook config. Never throws — returns null when unset or SaaS unreachable.
 */
export async function fetchJobWebhookConfig(
  apiKey: string,
  logger: Logger
): Promise<JobWebhookConfig | null> {
  const env = getEnv();
  try {
    const res = await fetch(env.mcpJobWebhookConfigUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SaaS-Secret": env.internalSecret,
      },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn("mcp job webhook config non-ok (ignored)", { status: res.status });
      return null;
    }
    const body = (await res.json()) as {
      url?: string | null;
      secret?: string | null;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const secret = typeof body.secret === "string" ? body.secret.trim() : "";
    if (!url || !secret) return null;
    if (!/^https:\/\//i.test(url)) {
      logger.warn("mcp job webhook url rejected (must be https)", {
        urlPreview: url.slice(0, 32),
      });
      return null;
    }
    return { url, secret };
  } catch (e) {
    logger.warn("mcp job webhook config fetch failed (ignored)", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Best-effort outbound notify. Retries a few times then gives up.
 * Callers must not await this for correctness — job results live in runStore / get_run.
 */
export async function deliverJobFinishedWebhook(
  config: JobWebhookConfig,
  run: StoredRun,
  logger: Logger
): Promise<boolean> {
  const payload = {
    event: "mcp.job.finished",
    runId: run.id,
    kind: run.kind,
    status: run.status,
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
    result: run.result ?? null,
    error: run.error ?? null,
  };
  const body = JSON.stringify(payload);
  const signature = signBody(config.secret, body);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ToolYour-Signature": signature,
          "X-ToolYour-Event": "mcp.job.finished",
          "X-ToolYour-Run-Id": run.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        logger.info("mcp job webhook delivered", {
          runId: run.id,
          attempt,
          status: res.status,
        });
        return true;
      }
      logger.warn("mcp job webhook non-2xx (will retry or skip)", {
        runId: run.id,
        attempt,
        status: res.status,
      });
    } catch (e) {
      logger.warn("mcp job webhook delivery error (will retry or skip)", {
        runId: run.id,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  logger.warn("mcp job webhook abandoned after retries — get_run still works", {
    runId: run.id,
  });
  return false;
}

/**
 * Optional notify after a run finishes. Never throws; never blocks job correctness.
 */
export async function notifyJobFinishedOptional(
  apiKey: string,
  run: StoredRun,
  logger: Logger
): Promise<WebhookNotifyResult> {
  try {
    const config = await fetchJobWebhookConfig(apiKey, logger);
    if (!config) {
      return {
        attempted: false,
        delivered: false,
        skippedReason: "no_webhook_configured_or_saas_unavailable",
      };
    }
    const delivered = await deliverJobFinishedWebhook(config, run, logger);
    return { attempted: true, delivered };
  } catch (e) {
    logger.warn("mcp job webhook notify crashed (ignored)", {
      runId: run.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      attempted: true,
      delivered: false,
      skippedReason: "notify_exception",
    };
  }
}
