import { createHmac } from "crypto";
import { getEnv } from "../config";
import type { Logger } from "../observability/logger";
import type { StoredRun } from "./store";

export interface JobWebhookConfig {
  url: string;
  secret: string;
}

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
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      url?: string;
      secret?: string;
    };
    if (!body.url || !body.secret) return null;
    return { url: body.url, secret: body.secret };
  } catch (e) {
    logger.warn("mcp job webhook config fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function deliverJobFinishedWebhook(
  config: JobWebhookConfig,
  run: StoredRun,
  logger: Logger
): Promise<void> {
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
        return;
      }
      logger.warn("mcp job webhook non-2xx", {
        runId: run.id,
        attempt,
        status: res.status,
      });
    } catch (e) {
      logger.warn("mcp job webhook delivery error", {
        runId: run.id,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}
