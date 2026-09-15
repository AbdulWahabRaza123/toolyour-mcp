import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import { extractJobReport } from "./job-report";
import {
  buildMatrixFromJobReport,
  compareEvaluationMatrices,
  computeCompositeScore,
  matrixToCapabilityGaps,
  type FeatureEvaluationMatrix,
} from "./evaluation-matrix";
import {
  detectFeatureDomain,
  extractFeatureRequirements,
  extractProjectName,
  extractRepoHint,
} from "./feature-domain";
import {
  createFeature,
  matchFeatures,
  updateFeature,
  type FeatureMemoryRecord,
  FeatureMemoryStoreError,
} from "../feature-memory/store";

export type FeatureMemoryRecordKeeping = {
  policy: "toolyour_auto_record";
  message: string;
  autoCaptureOn: Array<"verify_task_gate_pass" | "run_playbook_gate_pass" | "solve_task_gate_pass">;
  optOutField: "input.featureMemory.capture=false";
  manualRefineTool: "capture_feature";
  dashboardUrl: string;
};

export type FeatureMemoryEnvelope = {
  schemaVersion: "toolyour.featureMemory@1";
  domain: string;
  memoryType?: "feature" | "verification" | "workflow" | "project";
  recordKeeping: FeatureMemoryRecordKeeping;
  reminder?: string;
  matchConfidence?: "high" | "medium" | "low" | "none";
  matchMethod?: "hybrid_embedding";
  priorInstances?: FeatureMemoryRecord[];
  bestKnown?: FeatureMemoryRecord | null;
  communityPatterns?: FeatureMemoryRecord[];
  capabilityGaps?: Array<{ id: string; label: string; status: string; acceptance?: string }>;
  matrixComparison?: ReturnType<typeof compareEvaluationMatrices>;
  goldenPath?: string[];
};

export const FEATURE_MEMORY_RECORD_KEEPING: FeatureMemoryRecordKeeping = {
  policy: "toolyour_auto_record",
  message:
    "ToolYour is your cross-project institutional memory. On loop.gate=pass it records a purpose-typed memory row: feature builds → memoryType=feature; audits/ship-gates → verification; playbooks/pipelines → workflow. plan_task / recall_context filter by type so audits never look like implementation recipes. Opt out with input.featureMemory.capture=false.",
  autoCaptureOn: ["verify_task_gate_pass", "run_playbook_gate_pass", "solve_task_gate_pass"],
  optOutField: "input.featureMemory.capture=false",
  manualRefineTool: "capture_feature",
  dashboardUrl: "https://www.toolyour.com/dashboard/feature-memory",
};

export const FEATURE_MEMORY_GOLDEN_PATH = [
  "ToolYour auto-records purpose-typed memory on loop.gate=pass — you do not own persistence",
  "Before similar work → plan_task or recall_context (filtered by memoryType + projectScope)",
  "After host fixes → verify_task until pass so ToolYour captures the record",
  "Manual refine only → capture_feature to adjust title/requirements or supersedeFeatureId",
  "Compare iterations → compare_feature_memory; opt-in share → publish_feature_pattern",
];

export async function resolveFeatureMemorySession(apiKey: string, logger: Logger) {
  return validateApiKey(apiKey, "mcp/feature-memory", "node", logger);
}

export async function matchFeatureMemoryForGoal(opts: {
  apiKey: string;
  logger: Logger;
  goal: string;
  input?: Record<string, unknown>;
  memoryType?: FeatureMemoryRecord["memoryType"];
}): Promise<{
  domain: string;
  matches: FeatureMemoryRecord[];
  bestInDomain?: FeatureMemoryRecord | null;
  communityPatterns?: FeatureMemoryRecord[];
  matchMethod?: "hybrid_embedding";
  memoryType?: FeatureMemoryRecord["memoryType"];
  memoryDecision?: "reuse" | "adapt" | "create" | "none";
  confidence?: number;
} | null> {
  try {
    const session = await resolveFeatureMemorySession(opts.apiKey, opts.logger);
    const requirements = extractFeatureRequirements(opts.goal, opts.input);
    const domain = detectFeatureDomain(opts.goal, requirements);
    const memoryType = opts.memoryType || classifyMemoryType(opts.goal);
    const matched = await matchFeatures({
      userId: session.userId,
      goal: opts.goal,
      requirements,
      domain,
      limit: 5,
      memoryType,
      projectName: extractProjectName(opts.input),
      repoHint: extractRepoHint(opts.input),
    });
    const top = matched.matches[0];
    const topScore =
      top && typeof (top as { matchScore?: number }).matchScore === "number"
        ? (top as { matchScore: number }).matchScore
        : top
          ? 0.5
          : 0;
    let memoryDecision: "reuse" | "adapt" | "create" | "none" = "none";
    if (topScore >= 0.75) memoryDecision = "reuse";
    else if (topScore >= 0.4) memoryDecision = "adapt";
    else if (matched.matches.length === 0) memoryDecision = "create";
    else memoryDecision = "adapt";
    return {
      ...matched,
      memoryType,
      memoryDecision,
      confidence: Number(topScore.toFixed(3)),
    };
  } catch (e) {
    opts.logger.warn("feature memory match skipped", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Primary recall path for agents (Phase 5). Same backing data as plan_task.featureMemory,
 * without running the full planner.
 */
export async function recallContext(opts: {
  apiKey: string;
  logger: Logger;
  goal: string;
  input?: Record<string, unknown>;
  memoryType?: FeatureMemoryRecord["memoryType"];
}): Promise<Record<string, unknown>> {
  const requirements = extractFeatureRequirements(opts.goal, opts.input);
  const domain = detectFeatureDomain(opts.goal, requirements);
  const memoryType = opts.memoryType || classifyMemoryType(opts.goal);
  const matched = await matchFeatureMemoryForGoal(opts);
  const envelope: FeatureMemoryEnvelope = {
    schemaVersion: "toolyour.featureMemory@1",
    domain: matched?.domain || domain,
    memoryType,
    recordKeeping: FEATURE_MEMORY_RECORD_KEEPING,
    goldenPath: FEATURE_MEMORY_GOLDEN_PATH,
    reminder:
      matched && matched.matches.length
        ? buildFeatureMemoryReminder({
            goal: opts.goal,
            domain: matched.domain,
            matches: matched.matches,
            best: matched.bestInDomain,
          })
        : FEATURE_MEMORY_RECORD_KEEPING.message,
    matchConfidence:
      matched?.confidence && matched.confidence >= 0.75
        ? "high"
        : matched?.confidence && matched.confidence >= 0.4
          ? "medium"
          : matched?.matches?.length
            ? "low"
            : "none",
    matchMethod: matched?.matchMethod,
    priorInstances: matched?.matches,
    bestKnown: matched?.bestInDomain,
    communityPatterns: matched?.communityPatterns,
  };
  return {
    status: "recall",
    free: true,
    goal: opts.goal.trim(),
    memoryDecision: matched?.memoryDecision || "create",
    confidence: matched?.confidence ?? 0,
    reason:
      matched?.memoryDecision === "reuse"
        ? "A strong same-purpose prior record exists — adapt it before rebuilding."
        : matched?.memoryDecision === "adapt"
          ? "Related prior work exists — review bestKnown / priorInstances."
          : "No strong prior memory — create via a closable run then verify until pass.",
    recommendedNext:
      matched?.memoryDecision === "none" || matched?.memoryDecision === "create"
        ? "Call plan_task, then run_playbook / solve_task, then verify_task until loop.gate=pass."
        : "Read priorInstances / bestKnown, then run_playbook or solve_task with projectScope set.",
    projectScope: {
      projectName: extractProjectName(opts.input),
      repoHint: extractRepoHint(opts.input),
    },
    featureMemory: envelope,
  };
}

export function buildFeatureMemoryReminder(opts: {
  goal: string;
  domain: string;
  matches: FeatureMemoryRecord[];
  best?: FeatureMemoryRecord | null;
}): string | undefined {
  const top = opts.matches[0] || opts.best;
  if (!top) return undefined;
  const project = top.projectName ? ` in ${top.projectName}` : "";
  const score = top.compositeScore ? ` (composite ${top.compositeScore})` : "";
  return (
    `ToolYour found similar ${opts.domain} work${project}: "${top.title}"${score}. ` +
    `Read the matching memory type's bestKnown / priorInstances before repeating it. ` +
    `ToolYour auto-records new completions on verify_task gate pass.`
  );
}

export function classifyMemoryType(goal: string): "feature" | "verification" | "workflow" {
  if (
    /\b(audit|verify|validate|regression|ship[- ]?gate|security check|readiness|headers|seo[- ]site|web[- ]security)\b/i.test(
      goal
    )
  ) {
    return "verification";
  }
  if (/\b(workflow|pipeline|playbook|process|automation|run_playbook|run_workflow)\b/i.test(goal)) {
    return "workflow";
  }
  return "feature";
}

export function attachFeatureMemoryEnvelope(
  root: Record<string, unknown>,
  envelope: FeatureMemoryEnvelope
): void {
  root.featureMemory = envelope;
  if (envelope.reminder && typeof root.next === "string" && !root.next.includes("featureMemory")) {
    root.next = `${root.next} ${envelope.reminder}`.trim();
  } else if (envelope.reminder && !root.next) {
    root.next = envelope.reminder;
  }
}

export async function enrichWithFeatureMemory(
  root: Record<string, unknown>,
  opts: {
    apiKey: string;
    logger: Logger;
    goal: string;
    input?: Record<string, unknown>;
  }
): Promise<void> {
  const requirements = extractFeatureRequirements(opts.goal, opts.input);
  const inferredDomain = detectFeatureDomain(opts.goal, requirements);
  const inferredMemoryType = classifyMemoryType(opts.goal);

  const attachBaseline = () => {
    attachFeatureMemoryEnvelope(root, {
      schemaVersion: "toolyour.featureMemory@1",
      domain: inferredDomain,
      memoryType: inferredMemoryType,
      recordKeeping: FEATURE_MEMORY_RECORD_KEEPING,
      goldenPath: FEATURE_MEMORY_GOLDEN_PATH,
      reminder: FEATURE_MEMORY_RECORD_KEEPING.message,
    });
  };

  try {
    const matched = await matchFeatureMemoryForGoal(opts);

    if (
      !matched ||
      (!matched.matches.length && !matched.bestInDomain && !matched.communityPatterns?.length)
    ) {
      attachFeatureMemoryEnvelope(root, {
        schemaVersion: "toolyour.featureMemory@1",
        domain: matched?.domain || inferredDomain,
        memoryType: inferredMemoryType,
        recordKeeping: FEATURE_MEMORY_RECORD_KEEPING,
        goldenPath: FEATURE_MEMORY_GOLDEN_PATH,
        reminder: FEATURE_MEMORY_RECORD_KEEPING.message,
      });
      return;
    }

    const best = matched.bestInDomain || matched.matches[0];
    const topScore = matched.matches[0]?.matchScore ?? 0;
    const matchConfidence =
      topScore >= 0.45 ? "high" : topScore >= 0.25 ? "medium" : topScore > 0 ? "low" : "none";

    const matrix = best?.evaluationMatrix as FeatureEvaluationMatrix | undefined;
    const capabilityGaps = matrix ? matrixToCapabilityGaps(matrix) : undefined;

    const envelope: FeatureMemoryEnvelope = {
      schemaVersion: "toolyour.featureMemory@1",
      domain: matched.domain,
      memoryType: inferredMemoryType,
      recordKeeping: FEATURE_MEMORY_RECORD_KEEPING,
      matchConfidence,
      matchMethod: matched.matchMethod,
      priorInstances: matched.matches,
      bestKnown: best,
      communityPatterns: matched.communityPatterns,
      capabilityGaps,
      goldenPath: FEATURE_MEMORY_GOLDEN_PATH,
      reminder: buildFeatureMemoryReminder({
        goal: opts.goal,
        domain: matched.domain,
        matches: matched.matches,
        best,
      }),
    };

    attachFeatureMemoryEnvelope(root, envelope);
  } catch (e) {
    opts.logger.warn("feature memory enrich failed; attaching baseline recordKeeping", {
      message: e instanceof Error ? e.message : String(e),
    });
    attachBaseline();
  }
}

function isFeatureBuildGoal(goal: string): boolean {
  return /\b(implement|build|add|create|ship|deploy|feature|integrat|ocr|auth|payment|webhook|api)\b/i.test(
    goal
  );
}

function executionString(payload: Record<string, unknown>, key: string): string | undefined {
  const execution = payload.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) return undefined;
  const value = (execution as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function shouldAutoRecordCompletedFeature(opts: {
  goal: string;
  input?: Record<string, unknown>;
  payload: Record<string, unknown>;
  gate?: string;
}): boolean {
  if (opts.gate !== "pass") return false;

  const fm = opts.input?.featureMemory;
  if (fm && typeof fm === "object" && (fm as { capture?: boolean }).capture === false) {
    return false;
  }

  if (opts.payload.featureMemoryRecord || opts.payload.featureMemoryCapture) {
    return false;
  }

  const explicitCapture =
    typeof fm === "object" &&
    fm !== null &&
    (fm as { capture?: boolean }).capture === true;
  const hasExplicitFeatureInput =
    typeof opts.input?.featureTitle === "string" ||
    typeof opts.input?.requirements === "string" ||
    typeof opts.input?.featureRequirements === "string" ||
    explicitCapture;

  const memoryType = classifyMemoryType(opts.goal);

  // Phase 4: every completed closable run becomes durable purpose-typed memory.
  // verification/workflow rows never pollute feature recall (match filters by type).
  if (memoryType === "verification" || memoryType === "workflow") {
    return true;
  }

  // Feature type: only real builds (or explicit host naming), not one-shot converters.
  if (hasExplicitFeatureInput) return true;
  return isFeatureBuildGoal(opts.goal);
}

function appendRecordedNext(payload: Record<string, unknown>, featureId: string): void {
  const loop = payload.loop;
  if (!loop || typeof loop !== "object") return;
  const l = loop as Record<string, unknown>;
  const next = String(l.next || "");
  const line = `ToolYour recorded feature memory (${featureId}) — consult plan_task before similar work.`;
  if (!next.includes("ToolYour recorded feature memory")) {
    l.next = next ? `${next} ${line}` : line;
  }
}

export async function autoRecordCompletedFeature(opts: {
  apiKey: string;
  logger: Logger;
  goal: string;
  input?: Record<string, unknown>;
  payload: Record<string, unknown>;
  gate?: string;
  phase?: "run" | "verify";
}): Promise<void> {
  if (!shouldAutoRecordCompletedFeature(opts)) return;

  const fm = opts.input?.featureMemory;
  const title =
    typeof opts.input?.featureTitle === "string"
      ? opts.input.featureTitle
      : opts.goal.slice(0, 120);
  const report = extractJobReport(opts.payload);
  const sourceRunId =
    executionString(opts.payload, "runId") ||
    (report && typeof report.jobId === "string" ? report.jobId : undefined);
  const intentId = executionString(opts.payload, "intentId");
  const idempotencyKey =
    executionString(opts.payload, "idempotencyKey") ||
    (sourceRunId ? `capture:${sourceRunId}` : undefined);
  try {
    const captured = await captureFeatureMemory({
      apiKey: opts.apiKey,
      logger: opts.logger,
      title,
      requirements: extractFeatureRequirements(opts.goal, opts.input),
      projectName: extractProjectName(opts.input),
      repoHint: extractRepoHint(opts.input),
      baseline: opts.payload,
      supersedesFeatureId:
        typeof opts.input?.supersedesFeatureId === "string"
          ? opts.input.supersedesFeatureId
          : typeof (fm as { supersedesFeatureId?: string })?.supersedesFeatureId === "string"
            ? (fm as { supersedesFeatureId: string }).supersedesFeatureId
            : undefined,
      event: opts.phase === "verify" ? "verified" : "completed",
      memoryType: classifyMemoryType(opts.goal),
      sourceRunId,
      intentId,
      idempotencyKey,
    });
    const feature = captured.feature as FeatureMemoryRecord | undefined;
    if (feature?.featureId) {
      opts.payload.featureMemoryRecord = {
        status: "recorded",
        policy: FEATURE_MEMORY_RECORD_KEEPING.policy,
        message: `ToolYour recorded ${feature.memoryType || "feature"} memory as ${feature.featureId}. Cross-project agents will see it on plan_task / recall_context.`,
        featureId: feature.featureId,
        memoryType: feature.memoryType || classifyMemoryType(opts.goal),
        compositeScore: captured.compositeScore ?? feature.compositeScore,
        domain: feature.domain,
        capture: captured,
      };
      appendRecordedNext(opts.payload, feature.featureId);
    }
  } catch (e) {
    opts.logger.warn("feature memory auto-record skipped", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** @deprecated use autoRecordCompletedFeature */
export async function maybeCaptureFromVerifyPass(opts: {
  apiKey: string;
  logger: Logger;
  goal: string;
  input?: Record<string, unknown>;
  payload: Record<string, unknown>;
  gate?: string;
}): Promise<void> {
  await autoRecordCompletedFeature({ ...opts, phase: "verify" });
}

export async function captureFeatureMemory(opts: {
  apiKey: string;
  logger: Logger;
  title: string;
  requirements?: string;
  domain?: string;
  projectName?: string;
  repoHint?: string;
  baseline?: unknown;
  featureId?: string;
  supersedesFeatureId?: string;
  capabilities?: FeatureMemoryRecord["capabilities"];
  outcomesSummary?: string;
  event?: string;
  memoryType?: "feature" | "verification" | "workflow" | "project";
  sourceRunId?: string;
  intentId?: string;
  idempotencyKey?: string;
}): Promise<Record<string, unknown>> {
  const session = await resolveFeatureMemorySession(opts.apiKey, opts.logger);
  const requirements =
    opts.requirements?.trim() || opts.title.trim() || "Feature requirements not specified";
  const domain = opts.domain?.trim() || detectFeatureDomain(requirements);
  const report = extractJobReport(opts.baseline);
  const loop = opts.baseline && typeof opts.baseline === "object"
    ? (opts.baseline as { loop?: { gate?: string } }).loop
    : undefined;
  const gate = loop?.gate || (report ? undefined : undefined);
  const evaluationMatrix = buildMatrixFromJobReport(report, {
    gate: gate || (report ? undefined : "unknown"),
    incomplete: report?.incomplete,
  });
  const compositeScore = computeCompositeScore(evaluationMatrix);
  const verificationGate = gate || (report ? undefined : undefined);

  if (opts.featureId) {
    const updated = await updateFeature({
      featureId: opts.featureId,
      userId: session.userId,
      apiKeyId: session.apiKeyId,
      title: opts.title,
      requirements,
      projectName: opts.projectName,
      capabilities: opts.capabilities,
      evaluationMatrix: evaluationMatrix as never,
      compositeScore,
      outcomesSummary: opts.outcomesSummary,
      verificationGate: verificationGate as string | undefined,
      event: opts.event || "refined",
      logger: opts.logger,
      memoryType: opts.memoryType,
      sourceRunId: opts.sourceRunId,
      intentId: opts.intentId,
      idempotencyKey: opts.idempotencyKey,
    });
    if (!updated) {
      return {
        status: "error",
        code: "feature_not_found",
        message: `Feature ${opts.featureId} not found for this API key.`,
      };
    }
    return {
      status: "updated",
      feature: updated,
      evaluationMatrix,
      compositeScore,
    };
  }

  const created = await createFeature({
    userId: session.userId,
    apiKeyId: session.apiKeyId,
    domain,
    title: opts.title,
    requirements,
    projectName: opts.projectName || extractProjectName(
      opts.baseline && typeof opts.baseline === "object"
        ? (opts.baseline as Record<string, unknown>)
        : undefined
    ),
    repoHint: opts.repoHint,
    capabilities: opts.capabilities,
    evaluationMatrix: evaluationMatrix as never,
    compositeScore,
    outcomesSummary: opts.outcomesSummary,
    verificationGate: verificationGate as string | undefined,
    event: opts.event || (gate === "pass" ? "verified" : "completed"),
    supersedesFeatureId: opts.supersedesFeatureId,
    logger: opts.logger,
    memoryType: opts.memoryType,
    sourceRunId: opts.sourceRunId,
    intentId: opts.intentId,
    idempotencyKey: opts.idempotencyKey,
  });

  let matrixComparison;
  if (created.superseded?.evaluationMatrix) {
    matrixComparison = compareEvaluationMatrices(
      created.superseded.evaluationMatrix as FeatureEvaluationMatrix,
      evaluationMatrix
    );
  }

  return {
    status: "captured",
    feature: created.feature,
    superseded: created.superseded,
    evaluationMatrix,
    compositeScore,
    matrixComparison,
    reminder: created.superseded
      ? `Prior matrix composite ${created.superseded.compositeScore} → new ${compositeScore}. Port gaps from featureMemory.matrixComparison.`
      : undefined,
  };
}
