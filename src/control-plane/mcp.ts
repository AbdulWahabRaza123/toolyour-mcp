import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Logger } from "../observability/logger";
import { cancelledDecision, decide } from "./decide";
import { hashCanonical, ownerKeyFromApiKey } from "./hash";
import {
  expectedApproveToken,
  expectedRunnerToken,
  expectedStartToken,
  generateRunnerNonce,
  hashRunnerNonce,
  leakSecretKeys,
  nonceAccepted,
  submitHmacHex,
  tokenAccepted,
  tokensEqual,
  writeRunnerNonce,
} from "./secrets";
import { approvalBatch, parseApproval, parseDeclaredAction } from "./approvals";
import { ensureControlPlaneAccess } from "./opt-in";
import { jobStore, JobStoreError } from "./store";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REPEAT_FAIL_N,
  CHECK_KINDS,
  STARTABLE_TASK_IDS,
  JOB_TTL_MS,
  type Check,
  type CheckKind,
  type CheckResult,
  type FrozenTaskId,
  type Job,
  type NextAction,
  type ProjectSpec,
} from "./types";
import { isAllowedCheckCommand } from "./host-checks";

export interface ControlPlaneCtx {
  apiKey: string;
  logger: Logger;
}

export const CONTROL_PLANE_TOOLS = [
  "job_start",
  "job_status",
  "check_submit",
  "job_cancel",
] as const;

/** Always registered with the skill catalog. */
export const CONTROL_PLANE_APPROVAL_TOOLS = [
  "job_declare_action",
  "job_approve",
] as const;

/** Never register these. Host owns the shell; ToolYour is not an execution sandbox. */
export const FORBIDDEN_EXECUTION_TOOLS = [
  "execution.run",
  "execution_run",
  "run_shell",
  "shell_exec",
  "sandbox_exec",
  "sandbox_run",
] as const;

/** SHA-256 of fixture test files as committed. Existence-only checks are not enough. */
export const FROZEN_TEST_INVENTORY = [
  {
    rel: "tests/add.test.js",
    sha256: "c7b9284a8eae26b4e032cbd5691afb4106e947a826857beeb2af948fc43ec165",
  },
  {
    rel: "tests/health.test.js",
    sha256: "1bce215ac54183c53783a08f4ff34a0521a750941fa51235385bd8ea5a1faac8",
  },
  {
    rel: "tests/auth.test.js",
    sha256: "ea5ae5e55c57600a8290af5498d68a05583331062509039d58a3b43485146da3",
  },
  {
    rel: "tests/parser.test.js",
    sha256: "d4ee42787a42f1a35ad334ad795f590acb9c80c18c360e21d15e0241bbf90fab",
  },
  {
    rel: "tests/discount.test.js",
    sha256: "8bb52ab9479e0a91275720c18b63fe2d8dda52e9c00b0ed54c5503e7a9f28646",
  },
] as const;

export function frozenAssertCommand(rel: string, sha256: string): string {
  return `node ../../scripts/assert-frozen-file.mjs ${rel} --sha256 ${sha256}`;
}

export const ALLOWED_COMMANDS = new Set([
  "node --test tests/add.test.js",
  "node --test tests/health.test.js",
  "node --test tests/auth.test.js",
  "node --test tests/parser.test.js",
  "node --test tests/discount.test.js",
  ...FROZEN_TEST_INVENTORY.map((f) => frozenAssertCommand(f.rel, f.sha256)),
]);

export const DEFAULT_MCP_INSTRUCTIONS =
  "ToolYour has two loops. Pick exactly one per user goal — never both. " +
  "Skill loop (SEO, security, ship-gate, secrets, catalog): " +
  "(1) plan_task — if loop.initiate is false, stop; do not verify_task. " +
  "(2) solve_task or run_playbook — read loop.line (gate · rank-1 · credits), then loop.nextActions (rank-1 only) and loop.remainingFixes (full list with patchType + acceptance + roleHint). " +
  "(3) Host applies ONLY the rank-1 nextActions item in the workspace (editor/git/config) — do not invent tools or call invoke_tool for the same job. " +
  "(4) verify_task with the prior result as baseline until loop.gate is pass, or stop when loop.stop / loop.initiate is false (maxRounds=5, sameFindingsLimit=2). " +
  "Never pass localhost URLs. Credits buy evidence and re-checks — incomplete/OOS runs are not a pass. " +
  "Completion loop (frozen coding jobId): job_status only; edit on the host; run toolyour-check-run or control-plane-host.mjs. Do not invent check_submit. Do not mix plan_task/solve_task/verify_task with that jobId. " +
  "Host keeps editor, git, and terminal. This server does not replace Cursor, Claude, or any host agent.";

export function resolveMcpInstructions(): string {
  return DEFAULT_MCP_INSTRUCTIONS;
}

type RegisterTool = (
  server: McpServer,
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>
) => void;

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function err(code: string, message: string) {
  return textResult({ error: { code, message } }, true);
}

function storeErr(e: unknown) {
  if (e instanceof JobStoreError && e.code === "job_not_found") {
    return err("job_not_found", "Job not found or expired");
  }
  return err("store_unavailable", "Job store unavailable");
}

async function denyIfNotOptedIn(ctx: ControlPlaneCtx) {
  const access = await ensureControlPlaneAccess(ctx.apiKey, ctx.logger);
  if (!access.ok) return err(access.code, access.message);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseAcceptance(raw: unknown): ProjectSpec["acceptance"] | string {
  if (!Array.isArray(raw) || raw.length < 1) return "at least one acceptance criterion is required";
  const out: ProjectSpec["acceptance"] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const row = asRecord(item);
    const id = String(row.id || "").trim();
    const statement = String(row.statement || "").trim();
    const requiredCheckIds = Array.isArray(row.requiredCheckIds)
      ? row.requiredCheckIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!id || !statement) return "each AC needs id and statement";
    if (ids.has(id)) return `duplicate AC id: ${id}`;
    ids.add(id);
    out.push({ id, statement, requiredCheckIds });
  }
  return out;
}

function parseChecks(raw: unknown): Check[] | string {
  if (!Array.isArray(raw) || raw.length < 1) return "at least one check is required";
  const out: Check[] = [];
  const ids = new Set<string>();
  const kinds = new Set<CheckKind>(CHECK_KINDS);
  for (const item of raw) {
    const row = asRecord(item);
    const id = String(row.id || "").trim();
    const kind = String(row.kind || "test") as CheckKind;
    const command = String(row.command || "").trim();
    const blocking = row.blocking === undefined ? true : Boolean(row.blocking);
    if (!id || !command) return "each check needs id and command";
    if (ids.has(id)) return `duplicate check id: ${id}`;
    if (!kinds.has(kind)) return `invalid check kind: ${kind}`;
    if (!isAllowedCheckCommand(command, kind, ALLOWED_COMMANDS)) {
      return `command not in experiment allowlist: ${command}`;
    }
    ids.add(id);
    out.push({ id, kind, command, blocking });
  }
  return out;
}

function jobsDir(): string {
  return (
    process.env.CONTROL_PLANE_JOBS_DIR ||
    path.join(process.cwd(), "experiments", "jobs")
  );
}

function runChecksAction(job: Job): NextAction {
  return {
    type: "run_checks",
    targetCheckId: job.spec.checks[0]?.id || "chk_test",
    label: `Run node run-checks.mjs --job ${job.id} from experiments/control-plane-fixture (or node scripts/control-plane-host.mjs --job ${job.id} --cwd experiments/control-plane-fixture)`,
  };
}

function jobEnvelope(job: Job, extra: Record<string, unknown> = {}) {
  const bootstrap = job.state === "open" && !job.lastDecision;
  const decision = job.lastDecision;
  const batch = approvalBatch(job);
  const payload = {
    ok: true,
    jobId: job.id,
    taskId: job.taskId || null,
    state: job.state,
    specHash: job.specHash,
    iteration: job.iteration,
    goal: job.goal,
    checks: job.spec.checks.map((c) => ({
      id: c.id,
      kind: c.kind,
      command: c.command,
    })),
    lastDecision: decision,
    next_action: bootstrap ? runChecksAction(job) : decision?.next_action ?? null,
    remaining_requirements:
      decision?.remaining_requirements ?? job.spec.acceptance.map((a) => a.id),
    requires_human: Boolean(decision?.requires_human || batch),
    pending_approvals: batch?.actions ?? [],
    approval_batch: batch,
    ...extra,
  };
  const leaked = leakSecretKeys(payload);
  if (leaked.length) {
    throw new Error(`control-plane envelope leaked ${leaked.join(",")}`);
  }
  return payload;
}

function loadFrozenTask(taskId: string): { goal: string; spec: ProjectSpec } | string {
  if (!STARTABLE_TASK_IDS.includes(taskId as FrozenTaskId)) {
    return `taskId must be one of ${STARTABLE_TASK_IDS.join(", ")}`;
  }
  const file = path.join(jobsDir(), `${taskId}.json`);
  if (!fs.existsSync(file)) return `frozen job file missing: ${file}`;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return `frozen job file invalid JSON: ${file}`;
  }
  const goal = String(raw.goal || "").trim();
  if (!goal) return "frozen job is missing goal";
  const acceptance = parseAcceptance(raw.acceptance);
  if (typeof acceptance === "string") return acceptance;
  const checks = parseChecks(raw.checks);
  if (typeof checks === "string") return checks;
  const checkIds = new Set(checks.map((c) => c.id));
  for (const ac of acceptance) {
    for (const id of ac.requiredCheckIds) {
      if (!checkIds.has(id)) return `AC ${ac.id} references unknown check ${id}`;
    }
  }
  const maxIterations = Number(raw.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const repeatFailN = Number(raw.repeatFailN ?? DEFAULT_REPEAT_FAIL_N);
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 20) {
    return "maxIterations must be an integer 1–20";
  }
  if (!Number.isInteger(repeatFailN) || repeatFailN < 2 || repeatFailN > 10) {
    return "repeatFailN must be an integer 2–10";
  }
  return {
    goal,
    spec: {
      acceptance,
      checks,
      requiredCheckIds: checks.map((c) => c.id),
      maxIterations,
      repeatFailN,
    },
  };
}

async function handleStart(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const startToken = String(args.startToken || "").trim();
  if (!tokenAccepted(startToken, expectedStartToken())) {
    return err(
      "start_required",
      "job_start is experimenter-only. Use scripts/control-plane-start-job.mjs with CONTROL_PLANE_START_TOKEN."
    );
  }

  const taskId = String(args.taskId || "").trim();
  const loaded = loadFrozenTask(taskId);
  if (typeof loaded === "string") return err("invalid_input", loaded);

  const now = Date.now();
  const id = randomUUID();
  const nonce = generateRunnerNonce();
  writeRunnerNonce(id, nonce);
  const job: Job = {
    id,
    ownerKey: ownerKeyFromApiKey(ctx.apiKey),
    goal: loaded.goal,
    taskId: taskId as FrozenTaskId,
    spec: loaded.spec,
    specHash: hashCanonical(loaded.spec),
    state: "open",
    iteration: 0,
    maxIterations: loaded.spec.maxIterations,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + JOB_TTL_MS,
    lastDecision: null,
    iterations: [],
    declaredActions: [],
    approvals: [],
    runnerNonceHash: hashRunnerNonce(nonce),
  };
  try {
    await jobStore.create(job);
  } catch (e) {
    return storeErr(e);
  }
  ctx.logger.info("control-plane job_start", { jobId: job.id, taskId });
  return textResult(jobEnvelope(job));
}

function parseResults(raw: unknown): CheckResult[] | string {
  if (!Array.isArray(raw)) return "results must be an array";
  const out: CheckResult[] = [];
  const seen = new Set<string>();
  const statuses = new Set(["pass", "fail", "error"]);
  for (const item of raw) {
    const row = asRecord(item);
    const checkId = String(row.checkId || "").trim();
    const status = String(row.status || "");
    if (!checkId) return "each result needs checkId";
    if (seen.has(checkId)) return `duplicate result for ${checkId}`;
    if (!statuses.has(status)) return `invalid status for ${checkId}`;
    seen.add(checkId);
    out.push({
      checkId,
      status: status as CheckResult["status"],
      exitCode: Number(row.exitCode ?? (status === "pass" ? 0 : 1)),
      fingerprint: String(row.fingerprint || ""),
      summary: String(row.summary || "").slice(0, 500),
      logExcerpt: String(row.logExcerpt || "").slice(0, 8192),
    });
  }
  return out;
}

async function handleSubmit(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const token = String(args.runnerToken || "").trim();
  const nonce = String(args.runnerNonce || "").trim();
  if (!tokenAccepted(token, expectedRunnerToken())) {
    return err(
      "runner_required",
      "check_submit is host-runner only. Run toolyour-check-run or scripts/control-plane-host.mjs; do not invent pass/fail."
    );
  }

  const jobId = String(args.jobId || "").trim();
  let job;
  try {
    job = await jobStore.get(jobId);
  } catch (e) {
    return storeErr(e);
  }
  if (!job) return err("job_not_found", "Job not found or expired");
  if (!jobStore.owns(job, ownerKeyFromApiKey(ctx.apiKey))) {
    return err("unauthorized", "Job not owned by this API key");
  }
  if (job.state !== "open") {
    return err("job_terminal", `Job is ${job.state} and cannot accept check_submit`);
  }
  if (!nonceAccepted(nonce, job.runnerNonceHash)) {
    return err(
      "runner_required",
      "check_submit needs the host-only job nonce. Run toolyour-check-run or scripts/control-plane-host.mjs."
    );
  }

  const results = parseResults(args.results);
  if (typeof results === "string") return err("invalid_input", results);

  const known = new Set(job.spec.checks.map((c) => c.id));
  for (const r of results) {
    if (!known.has(r.checkId)) {
      return err("check_unknown", `Unknown checkId: ${r.checkId}`);
    }
  }

  const gitSha =
    typeof args.gitSha === "string" && args.gitSha.trim()
      ? args.gitSha.trim()
      : undefined;
  const treeHash =
    typeof args.treeHash === "string" && args.treeHash.trim()
      ? args.treeHash.trim()
      : undefined;

  const presentedHmac = String(args.submitHmac || "").trim();
  const requireHmac = ["true", "1"].includes(
    String(process.env.CONTROL_PLANE_REQUIRE_HMAC || "")
      .trim()
      .toLowerCase()
  );
  if (requireHmac && !presentedHmac) {
    return err(
      "runner_required",
      "check_submit HMAC required. Run toolyour-check-run."
    );
  }
  if (presentedHmac) {
    const expected = submitHmacHex(token, jobId, nonce, treeHash || "", results);
    if (!tokensEqual(presentedHmac, expected)) {
      return err("runner_required", "check_submit HMAC mismatch");
    }
  }

  const decided = decide(job, results, gitSha, treeHash);
  if (!decided.ok) {
    return err(decided.error.code, decided.error.message);
  }

  const decision = decided.decision;
  const n = job.iterations.length + 1;
  job.iterations.push({
    n,
    submittedAt: Date.now(),
    gitSha,
    treeHash,
    results,
    decision,
  });
  job.iteration = n;
  job.lastDecision = decision;
  job.updatedAt = Date.now();
  if (decision.status === "verified" || decision.status === "escalated") {
    job.state = decision.status;
  }
  try {
    await jobStore.update(job);
  } catch (e) {
    return storeErr(e);
  }
  return textResult({
    ...jobEnvelope(job),
    ...decision,
  });
}

async function handleStatus(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const jobId = String(args.jobId || "").trim();
  let job;
  try {
    job = await jobStore.get(jobId);
  } catch (e) {
    return storeErr(e);
  }
  if (!job) return err("job_not_found", "Job not found or expired");
  if (!jobStore.owns(job, ownerKeyFromApiKey(ctx.apiKey))) {
    return err("unauthorized", "Job not owned by this API key");
  }
  return textResult(jobEnvelope(job));
}

async function handleCancel(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const jobId = String(args.jobId || "").trim();
  let job;
  try {
    job = await jobStore.get(jobId);
  } catch (e) {
    return storeErr(e);
  }
  if (!job) return err("job_not_found", "Job not found or expired");
  if (!jobStore.owns(job, ownerKeyFromApiKey(ctx.apiKey))) {
    return err("unauthorized", "Job not owned by this API key");
  }
  if (job.state !== "open") {
    return err("job_terminal", `Job is ${job.state} and cannot be cancelled`);
  }
  const decision = cancelledDecision(job);
  job.state = "cancelled";
  job.lastDecision = decision;
  job.updatedAt = Date.now();
  try {
    await jobStore.update(job);
  } catch (e) {
    return storeErr(e);
  }
  return textResult({
    ...jobEnvelope(job),
    ...decision,
  });
}

async function loadOwnedOpenJob(
  jobId: string,
  ctx: ControlPlaneCtx
): Promise<{ ok: true; job: Job } | { ok: false; error: ReturnType<typeof err> }> {
  let job;
  try {
    job = await jobStore.get(jobId);
  } catch (e) {
    return { ok: false, error: storeErr(e) };
  }
  if (!job) return { ok: false, error: err("job_not_found", "Job not found or expired") };
  if (!jobStore.owns(job, ownerKeyFromApiKey(ctx.apiKey))) {
    return { ok: false, error: err("unauthorized", "Job not owned by this API key") };
  }
  if (job.state !== "open") {
    return { ok: false, error: err("job_terminal", `Job is ${job.state}`) };
  }
  return { ok: true, job };
}

async function handleDeclareAction(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const loaded = await loadOwnedOpenJob(String(args.jobId || "").trim(), ctx);
  if (!loaded.ok) return loaded.error;
  const job = loaded.job;
  const parsed = parseDeclaredAction(args, job);
  if (typeof parsed === "string") return err("invalid_input", parsed);
  job.declaredActions = [...(job.declaredActions || []), parsed];
  job.updatedAt = Date.now();
  try {
    await jobStore.update(job);
  } catch (e) {
    return storeErr(e);
  }
  ctx.logger.info("control-plane job_declare_action", {
    jobId: job.id,
    actionId: parsed.id,
    risk: parsed.risk,
  });
  return textResult({
    ...jobEnvelope(job),
    declared: {
      id: parsed.id,
      actionClass: parsed.actionClass,
      resourceGlob: parsed.resourceGlob,
      risk: parsed.risk,
    },
  });
}

async function handleApprove(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const denied = await denyIfNotOptedIn(ctx);
  if (denied) return denied;
  const approveToken = String(args.approveToken || "").trim();
  if (!tokenAccepted(approveToken, expectedApproveToken())) {
    return err(
      "approve_required",
      "job_approve is human-only. Set CONTROL_PLANE_APPROVE_TOKEN and pass approveToken. There is no approve-all."
    );
  }
  const actionId = String(args.actionId || "").trim();
  if (!actionId) return err("invalid_input", "actionId is required (one action per call)");
  const loaded = await loadOwnedOpenJob(String(args.jobId || "").trim(), ctx);
  if (!loaded.ok) return loaded.error;
  const job = loaded.job;
  const action = (job.declaredActions || []).find((a) => a.id === actionId);
  if (!action) return err("invalid_input", "Unknown actionId on this job");
  if (action.status && action.status !== "pending") {
    return err("invalid_input", `Action is already ${action.status}`);
  }
  const parsed = parseApproval(args, action, ownerKeyFromApiKey(ctx.apiKey).slice(0, 12));
  if (typeof parsed === "string") return err("invalid_input", parsed);
  action.status = "approved";
  job.approvals = [...(job.approvals || []), parsed];
  job.updatedAt = Date.now();
  try {
    await jobStore.update(job);
  } catch (e) {
    return storeErr(e);
  }
  return textResult({
    ...jobEnvelope(job),
    approved: { actionId: action.id, approvalId: parsed.id },
  });
}

const checkResultSchema = z.object({
  checkId: z.string(),
  status: z.enum(["pass", "fail", "error"]),
  exitCode: z.number().optional(),
  fingerprint: z.string().optional(),
  summary: z.string().optional(),
  logExcerpt: z.string().optional(),
});

export function registerControlPlaneTools(
  server: McpServer,
  registerTool: RegisterTool,
  ctx: ControlPlaneCtx,
  opts: { approvals?: boolean } = {}
): void {
  registerTool(
    server,
    "job_start",
    "Completion-loop: start a frozen task (task-1 … task-5, or optional host-playwright). Do not use for SEO, URLs, or ship-gate — those use plan_task. Agents that already have a jobId must call job_status instead.",
    {
      taskId: z.enum(STARTABLE_TASK_IDS),
      startToken: z.string().optional(),
    },
    async (args) => handleStart(args, ctx)
  );

  registerTool(
    server,
    "job_status",
    "Completion-loop status for an existing jobId (state, frozen checks, next_action). Do not use for catalog/SEO goals — those use plan_task.",
    { jobId: z.string() },
    async (args) => handleStatus(args, ctx)
  );

  registerTool(
    server,
    "check_submit",
    "Completion-loop: host runner only. Run toolyour-check-run or control-plane-host.mjs. Do not invent results. Do not use for skill-loop verify_task jobs. No job_complete.",
    {
      jobId: z.string(),
      runnerToken: z.string().optional(),
      runnerNonce: z.string().optional(),
      submitHmac: z.string().optional(),
      gitSha: z.string().optional(),
      treeHash: z.string().optional(),
      results: z.array(checkResultSchema),
    },
    async (args) => handleSubmit(args, ctx)
  );

  registerTool(
    server,
    "job_cancel",
    "Completion-loop: cancel an open frozen job. Does not cancel skill-loop runs (use the run lifecycle for those).",
    { jobId: z.string() },
    async (args) => handleCancel(args, ctx)
  );

  if (!opts.approvals) return;

  registerTool(
    server,
    "job_declare_action",
    "Declare a HIGH or CRITICAL host action for this job. ToolYour cannot see undeclared shell commands. Not an approve-all.",
    {
      jobId: z.string(),
      actionClass: z.string(),
      resourceGlob: z.string(),
      risk: z.enum(["HIGH", "CRITICAL"]),
      label: z.string().optional(),
      iterationFrom: z.number().optional(),
      iterationTo: z.number().optional(),
    },
    async (args) => handleDeclareAction(args, ctx)
  );

  registerTool(
    server,
    "job_approve",
    "Human-only scoped approval for one declared actionId. Requires CONTROL_PLANE_APPROVE_TOKEN. CRITICAL needs breakGlass. No approve-all.",
    {
      jobId: z.string(),
      actionId: z.string(),
      approveToken: z.string().optional(),
      breakGlass: z.boolean().optional(),
      expiresAt: z.number().optional(),
    },
    async (args) => handleApprove(args, ctx)
  );
}
