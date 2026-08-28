import { randomUUID } from "crypto";
import { validateApiKey } from "../auth/session";
import type { Logger } from "../observability/logger";
import { extractJobReport, type VerifyGate } from "./job-report";
import { buildEvidencePack, buildRegressionAlert } from "./evidence";
import { diffJobReports, type VerifyDelta } from "./verify-task";
import {
  createProfile,
  getProfile,
  patchProfileSnapshots,
  ProfileStoreError,
} from "../verification/profile-store";

export type VerificationEnvelope = {
  schemaVersion: "toolyour.verification@1";
  profileId?: string;
  targetUrl?: string;
  playbook?: string;
  runId: string;
  baselineRunId?: string | null;
  evidence: ReturnType<typeof buildEvidencePack>;
  regressionAlert?: string;
  contract?: {
    gatePolicy?: string;
    gate?: VerifyGate;
  };
  goldenPath?: string[];
};

export function extractProfileId(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const top = input.profileId;
  if (typeof top === "string" && top.trim()) return top.trim();
  const verification = input.verification;
  if (verification && typeof verification === "object") {
    const vid = (verification as { profileId?: string }).profileId;
    if (typeof vid === "string" && vid.trim()) return vid.trim();
  }
  return undefined;
}

export function extractTargetUrl(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const url = input.url || input.pageUrl || input.siteUrl;
  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

export async function resolveVerificationSession(apiKey: string, logger: Logger) {
  return validateApiKey(apiKey, "mcp/verification-profile", "node", logger);
}

export async function ensureVerificationProfile(opts: {
  apiKey: string;
  logger: Logger;
  profileId?: string;
  targetUrl?: string;
  playbook: string;
  label?: string;
  autoCreate?: boolean;
}): Promise<{
  profileId?: string;
  lastPassSnapshot: Record<string, unknown> | null;
  lastRunSnapshot: Record<string, unknown> | null;
  lastPassAt?: string | null;
  lastPassGate?: string | null;
  lastPassRunId?: string | null;
}> {
  const session = await resolveVerificationSession(opts.apiKey, opts.logger);

  if (opts.profileId) {
    try {
      const found = await getProfile(opts.profileId, session.apiKeyId);
      if (!found) return { profileId: opts.profileId, lastPassSnapshot: null, lastRunSnapshot: null };
      return {
        profileId: found.profile.profileId,
        lastPassSnapshot: found.lastPassSnapshot,
        lastRunSnapshot: found.lastRunSnapshot,
        lastPassAt: found.profile.lastPassAt,
        lastPassGate: found.profile.lastPassGate,
        lastPassRunId: found.profile.lastPassRunId,
      };
    } catch (e) {
      if (e instanceof ProfileStoreError && e.code === "unavailable") {
        opts.logger.warn("verification profile store unavailable", { profileId: opts.profileId });
      }
      return { profileId: opts.profileId, lastPassSnapshot: null, lastRunSnapshot: null };
    }
  }

  const autoCreate = opts.autoCreate !== false;
  const targetUrl = opts.targetUrl;
  if (!autoCreate || !targetUrl || !/^https:\/\//i.test(targetUrl)) {
    return { lastPassSnapshot: null, lastRunSnapshot: null };
  }

  try {
    const created = await createProfile({
      userId: session.userId,
      apiKeyId: session.apiKeyId,
      targetUrl,
      playbook: opts.playbook,
      label: opts.label,
    });
    return {
      profileId: created.profile.profileId,
      lastPassSnapshot: created.lastPassSnapshot || null,
      lastRunSnapshot: created.lastRunSnapshot || null,
    };
  } catch (e) {
    opts.logger.warn("verification profile auto-create failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { lastPassSnapshot: null, lastRunSnapshot: null };
  }
}

export async function persistVerificationRun(opts: {
  apiKey: string;
  logger: Logger;
  profileId?: string;
  runPayload: Record<string, unknown>;
  runId: string;
  gate?: VerifyGate;
}): Promise<void> {
  if (!opts.profileId) return;
  const session = await resolveVerificationSession(opts.apiKey, opts.logger);
  const pass = opts.gate === "pass";
  try {
    await patchProfileSnapshots({
      profileId: opts.profileId,
      apiKeyId: session.apiKeyId,
      lastRunSnapshot: opts.runPayload,
      ...(pass
        ? {
            lastPassSnapshot: opts.runPayload,
            lastPassRunId: opts.runId,
            lastPassGate: opts.gate,
          }
        : {}),
      logger: opts.logger,
    });
  } catch (e) {
    opts.logger.warn("verification profile persist skipped", {
      profileId: opts.profileId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export function attachVerificationEnvelope(
  root: Record<string, unknown>,
  opts: {
    profileId?: string;
    targetUrl?: string;
    playbook?: string;
    runId?: string;
    baselineRunId?: string | null;
    delta?: VerifyDelta | null;
    lastPassAt?: string | null;
    lastPassGate?: string | null;
    phase: "run" | "verify";
  }
): void {
  const report = extractJobReport(root);
  const loop = root.loop as { gate?: VerifyGate; remainingFixes?: unknown[] } | undefined;
  const gate = opts.delta?.gate || loop?.gate;
  const runId = opts.runId || randomUUID().replace(/-/g, "").slice(0, 16);

  const evidence = buildEvidencePack({
    report,
    remainingFixes: (opts.delta?.remainingFixes ||
      (loop?.remainingFixes as never) ||
      []) as never,
    delta: opts.delta,
    url: opts.targetUrl || report?.url,
    runId,
    baselineRunId: opts.baselineRunId,
  });

  const regressionAlert = buildRegressionAlert({
    delta: opts.delta,
    profileLastPassAt: opts.lastPassAt,
    profileLastPassGate: opts.lastPassGate,
  });

  const envelope: VerificationEnvelope = {
    schemaVersion: "toolyour.verification@1",
    profileId: opts.profileId,
    targetUrl: opts.targetUrl || report?.url,
    playbook: opts.playbook,
    runId,
    baselineRunId: opts.baselineRunId,
    evidence,
    ...(regressionAlert ? { regressionAlert } : {}),
    contract: {
      gatePolicy: report?.gatePolicy,
      gate,
    },
    goldenPath: [
      "1. plan_task(goal with preview https URL) — free",
      "2. run_playbook(playbook, { url, profileId? }) — read verification.evidence + loop.line",
      "3. Host applies ONLY loop.nextActions[0] (patchType + acceptance)",
      "4. Redeploy preview if needed",
      "5. verify_task(goal, { url, profileId }, baseline=<entire prior result>)",
      "6. Repeat until loop.gate=pass or loop.stop",
    ],
  };

  root.verification = envelope;

  if (opts.phase === "run" && gate !== "pass" && evidence[0]) {
    const existingNext = typeof root.next === "string" ? root.next : "";
    if (!existingNext.includes("verify_task")) {
      root.next = `${existingNext ? `${existingNext} ` : ""}Apply rank-1 from verification.evidence[0], redeploy if needed, then verify_task with this entire result as baseline.`;
    }
  }
}

export function baselineFromProfileLastRun(
  lastRunSnapshot: Record<string, unknown> | null
): unknown | undefined {
  if (!lastRunSnapshot || typeof lastRunSnapshot !== "object") return undefined;
  if (extractJobReport(lastRunSnapshot)) return lastRunSnapshot;
  return undefined;
}

export function regressionVsLastPass(
  lastPassSnapshot: Record<string, unknown> | null,
  currentReport: ReturnType<typeof extractJobReport>
): VerifyDelta | null {
  const before = extractJobReport(lastPassSnapshot);
  if (!before || !currentReport) return null;
  return diffJobReports(before, currentReport);
}
