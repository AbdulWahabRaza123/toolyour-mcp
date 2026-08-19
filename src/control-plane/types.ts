export type JobState = "open" | "verified" | "escalated" | "cancelled";
export type DecisionStatus = "continue" | "verified" | "escalated" | "cancelled";
export type CheckResultStatus = "pass" | "fail" | "error";
export type RuleId = "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9";
export type NextActionType = "fix" | "run_checks" | "await_approval";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DeclaredActionStatus = "pending" | "approved" | "denied";

export const CHECK_KINDS = ["test", "lint", "typecheck", "playwright"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export const DEFAULT_MAX_ITERATIONS = 8;
export const DEFAULT_REPEAT_FAIL_N = 3;
export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FROZEN_TASK_IDS = ["task-1", "task-2", "task-3", "task-4", "task-5"] as const;
/** Optional host E2E template. Not part of the experiment eval (task-1 … task-5). */
export const OPTIONAL_HOST_TASK_IDS = ["host-playwright"] as const;
export const STARTABLE_TASK_IDS = [
  ...FROZEN_TASK_IDS,
  ...OPTIONAL_HOST_TASK_IDS,
] as const;
export type FrozenTaskId = (typeof STARTABLE_TASK_IDS)[number];

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  requiredCheckIds: string[];
}

export interface Check {
  id: string;
  kind: CheckKind;
  command: string;
  blocking: boolean;
}

export interface ProjectSpec {
  acceptance: AcceptanceCriterion[];
  checks: Check[];
  requiredCheckIds: string[];
  maxIterations: number;
  repeatFailN: number;
}

export interface CheckResult {
  checkId: string;
  status: CheckResultStatus;
  exitCode: number;
  fingerprint: string;
  summary: string;
  logExcerpt: string;
}

export interface NextAction {
  type: NextActionType;
  targetCheckId: string;
  label: string;
  testNames?: string[];
  snippet?: string;
  targetActionId?: string;
}

export interface DecisionEvidence {
  iteration: number;
  gitSha?: string;
  treeHash?: string;
  fingerprints: Array<{ checkId: string; fingerprint: string; status: CheckResultStatus }>;
}

export interface Decision {
  status: DecisionStatus;
  next_action: NextAction | null;
  reason: string;
  ruleId: RuleId;
  requires_human: boolean;
  remaining_requirements: string[];
  evidence: DecisionEvidence;
}

export interface JobIteration {
  n: number;
  submittedAt: number;
  gitSha?: string;
  treeHash?: string;
  results: CheckResult[];
  decision: Decision;
}

export interface DeclaredAction {
  id: string;
  actionClass: string;
  resourceGlob: string;
  risk: RiskClass;
  label: string;
  status: DeclaredActionStatus;
  createdAt: number;
  iterationFrom?: number;
  iterationTo?: number;
}

export interface JobApproval {
  id: string;
  actionId: string;
  actionClass: string;
  resourceGlob: string;
  actor: string;
  createdAt: number;
  expiresAt: number;
  iterationFrom?: number;
  iterationTo?: number;
  breakGlass?: boolean;
}

export interface Job {
  id: string;
  ownerKey: string;
  goal: string;
  taskId?: FrozenTaskId;
  spec: ProjectSpec;
  specHash: string;
  state: JobState;
  iteration: number;
  maxIterations: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastDecision: Decision | null;
  iterations: JobIteration[];
  /** SHA-256 of host-only nonce. Never returned over MCP. */
  runnerNonceHash?: string;
  /** Host-declared HIGH/CRITICAL actions. Undeclared shell work is out of contract. */
  declaredActions?: DeclaredAction[];
  approvals?: JobApproval[];
}

export type DecideResult =
  | { ok: true; decision: Decision }
  | {
      ok: false;
      ruleId: "R1";
      error: { code: "check_required_missing"; message: string };
    };
