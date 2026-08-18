import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Logger } from "../observability/logger";
import { cancelledDecision, decide } from "./decide";
import { hashCanonical, ownerKeyFromApiKey } from "./hash";
import {
  expectedRunnerToken,
  expectedStartToken,
  generateRunnerNonce,
  hashRunnerNonce,
  leakSecretKeys,
  nonceAccepted,
  tokenAccepted,
  writeRunnerNonce,
} from "./secrets";
import { jobStore } from "./store";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REPEAT_FAIL_N,
  FROZEN_TASK_IDS,
  JOB_TTL_MS,
  type Check,
  type CheckKind,
  type CheckResult,
  type FrozenTaskId,
  type Job,
  type NextAction,
  type ProjectSpec,
} from "./types";

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

/** SHA-256 of fixture test files as committed. Existence-only checks are not enough. */
export const FROZEN_TEST_INVENTORY = [
  {
    rel: "tests/add.test.js",
    sha256: "089c0ba98471e2e2ef5871c491952eeaec20f8e4c28d4e77d86e90af557d26bf",
  },
  {
    rel: "tests/health.test.js",
    sha256: "0b57cb5e7d1ef5e573e1675f9877de8acd8decf4f3f3bb00a6f85b37782fa615",
  },
  {
    rel: "tests/auth.test.js",
    sha256: "a67076b40541ecce094ab7ade5dafdbec7d9521ca8ed2d37cf3ef7548037a584",
  },
  {
    rel: "tests/parser.test.js",
    sha256: "3babf837d45354f410482c981e0bea827e2b25a11f836e9464eedc86201aa528",
  },
  {
    rel: "tests/discount.test.js",
    sha256: "b0ecbfb941ca206c305730cde36f85dba2558952cead6a14954290199f402fc3",
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
  "ToolYour is a remote MCP harness. First call plan_task. Only enter plan → run → verify when loop.initiate is true (MCP tools can close the job). If loop.initiate is false, stop — do not call verify_task. Host agents keep editor, git, and terminal. invoke_tool is one-off only. Do not claim this server replaces Cursor or Claude.";

export const CONTROL_PLANE_EXPERIMENT_INSTRUCTIONS =
  "EXPERIMENT MODE: Isolated control-plane MCP. You already have a jobId. Call job_status, edit experiments/control-plane-fixture/lib only, then from that folder run: node run-checks.mjs --job <id>. Do not call job_start. Do not invent check_submit results. There is no job_complete. Stop when state is verified or escalated. Host agents keep editor, git, and terminal.";

export function isControlPlaneExperimentEnabled(): boolean {
  const v = String(process.env.CONTROL_PLANE_EXPERIMENT || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Local preview of production registration: catalog first, then job tools. Ignored when the experiment flag is on. Never set in production until the design is reviewed. */
export function isControlPlaneAdditiveEnabled(): boolean {
  if (isControlPlaneExperimentEnabled()) return false;
  const v = String(process.env.CONTROL_PLANE_ADDITIVE || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export const CONTROL_PLANE_ADDITIVE_INSTRUCTIONS =
  `${DEFAULT_MCP_INSTRUCTIONS} Job tools (job_status, check_submit) are additive and do not replace plan_task. Do not invent check_submit results. There is no job_complete. Host runner: node scripts/control-plane-host.mjs --job <id> --cwd <repo>.`;

export function resolveMcpInstructions(
  experiment = isControlPlaneExperimentEnabled(),
  additive = isControlPlaneAdditiveEnabled()
): string {
  if (experiment) return CONTROL_PLANE_EXPERIMENT_INSTRUCTIONS;
  if (additive) return CONTROL_PLANE_ADDITIVE_INSTRUCTIONS;
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
  const kinds = new Set<CheckKind>(["test", "lint", "typecheck"]);
  for (const item of raw) {
    const row = asRecord(item);
    const id = String(row.id || "").trim();
    const kind = String(row.kind || "test") as CheckKind;
    const command = String(row.command || "").trim();
    const blocking = row.blocking === undefined ? true : Boolean(row.blocking);
    if (!id || !command) return "each check needs id and command";
    if (ids.has(id)) return `duplicate check id: ${id}`;
    if (!kinds.has(kind)) return `invalid check kind: ${kind}`;
    if (!ALLOWED_COMMANDS.has(command)) {
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
    requires_human: decision?.requires_human ?? false,
    ...extra,
  };
  const leaked = leakSecretKeys(payload);
  if (leaked.length) {
    throw new Error(`control-plane envelope leaked ${leaked.join(",")}`);
  }
  return payload;
}

function loadFrozenTask(taskId: string): { goal: string; spec: ProjectSpec } | string {
  if (!FROZEN_TASK_IDS.includes(taskId as FrozenTaskId)) {
    return `taskId must be one of ${FROZEN_TASK_IDS.join(", ")}`;
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
    runnerNonceHash: hashRunnerNonce(nonce),
  };
  jobStore.create(job);
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
  const token = String(args.runnerToken || "").trim();
  const nonce = String(args.runnerNonce || "").trim();
  if (!tokenAccepted(token, expectedRunnerToken())) {
    return err(
      "runner_required",
      "check_submit is host-runner only. Run scripts/control-plane-host.mjs; do not invent pass/fail."
    );
  }

  const jobId = String(args.jobId || "").trim();
  const job = jobStore.get(jobId);
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
      "check_submit needs the host-only job nonce. Run scripts/control-plane-host.mjs."
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
  jobStore.update(job);
  return textResult({
    ...jobEnvelope(job),
    ...decision,
  });
}

async function handleStatus(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const jobId = String(args.jobId || "").trim();
  const job = jobStore.get(jobId);
  if (!job) return err("job_not_found", "Job not found or expired");
  if (!jobStore.owns(job, ownerKeyFromApiKey(ctx.apiKey))) {
    return err("unauthorized", "Job not owned by this API key");
  }
  return textResult(jobEnvelope(job));
}

async function handleCancel(args: Record<string, unknown>, ctx: ControlPlaneCtx) {
  const jobId = String(args.jobId || "").trim();
  const job = jobStore.get(jobId);
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
  jobStore.update(job);
  return textResult({
    ...jobEnvelope(job),
    ...decision,
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
  ctx: ControlPlaneCtx
): void {
  registerTool(
    server,
    "job_start",
    "EXPERIMENT: experimenter-only. Starts a frozen task (task-1 … task-5). Agents already have a jobId — call job_status instead.",
    {
      taskId: z.enum(["task-1", "task-2", "task-3", "task-4", "task-5"]),
      startToken: z.string().optional(),
    },
    async (args) => handleStart(args, ctx)
  );

  registerTool(
    server,
    "job_status",
    "EXPERIMENT: read job state, frozen checks, next_action, and lastDecision.",
    { jobId: z.string() },
    async (args) => handleStatus(args, ctx)
  );

  registerTool(
    server,
    "check_submit",
    "EXPERIMENT: host runner only. Agents must run control-plane-host.mjs instead of inventing results. No job_complete.",
    {
      jobId: z.string(),
      runnerToken: z.string().optional(),
      runnerNonce: z.string().optional(),
      gitSha: z.string().optional(),
      treeHash: z.string().optional(),
      results: z.array(checkResultSchema),
    },
    async (args) => handleSubmit(args, ctx)
  );

  registerTool(
    server,
    "job_cancel",
    "EXPERIMENT: cancel an open control-plane job.",
    { jobId: z.string() },
    async (args) => handleCancel(args, ctx)
  );
}
