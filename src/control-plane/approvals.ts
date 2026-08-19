import { randomUUID } from "crypto";
import type { DeclaredAction, Job, JobApproval, RiskClass } from "./types";

const UNBOUNDED = new Set(["*", "**", "**/*", "/*", "/", "*.*", "*/*"]);

export function isUnboundedResourceGlob(glob: string): boolean {
  const n = String(glob || "").trim();
  if (!n) return true;
  if (UNBOUNDED.has(n)) return true;
  return /^[\/*]+$/.test(n);
}

export function isBlockingRisk(risk: RiskClass): boolean {
  return risk === "HIGH" || risk === "CRITICAL";
}

export function pendingDeclaredActions(
  job: Job,
  now = Date.now(),
  iteration = job.iteration
): DeclaredAction[] {
  const declared = job.declaredActions || [];
  const approvals = job.approvals || [];
  return declared.filter((action) => {
    if (!isBlockingRisk(action.risk)) return false;
    if (action.status && action.status !== "pending") return false;
    const from = action.iterationFrom ?? 0;
    const to = action.iterationTo ?? job.maxIterations;
    if (iteration < from || iteration > to) return false;
    return !approvals.some((ap) => approvalCovers(ap, action, now, iteration));
  });
}

export function approvalCovers(
  approval: JobApproval,
  action: DeclaredAction,
  now: number,
  iteration: number
): boolean {
  if (approval.actionId !== action.id) return false;
  if (approval.expiresAt <= now) return false;
  if (action.risk === "CRITICAL" && approval.breakGlass !== true) return false;
  const from = approval.iterationFrom ?? action.iterationFrom ?? 0;
  const to = approval.iterationTo ?? action.iterationTo ?? Number.POSITIVE_INFINITY;
  return iteration >= from && iteration <= to;
}

export function approvalBatch(job: Job, now = Date.now()) {
  const pending = pendingDeclaredActions(job, now);
  if (!pending.length) return null;
  return {
    count: pending.length,
    note: "Approve each actionId separately. There is no approve-all. Undeclared shell actions are out of contract.",
    actions: pending.map((a) => ({
      id: a.id,
      actionClass: a.actionClass,
      resourceGlob: a.resourceGlob,
      risk: a.risk,
      label: a.label,
    })),
  };
}

export function parseDeclaredAction(args: Record<string, unknown>, job: Job): DeclaredAction | string {
  const actionClass = String(args.actionClass || "")
    .trim()
    .toLowerCase();
  const resourceGlob = String(args.resourceGlob || "").trim();
  const risk = String(args.risk || "").trim().toUpperCase() as RiskClass;
  const label = String(args.label || "").trim().slice(0, 200);
  if (!actionClass || actionClass.length > 64 || /\s/.test(actionClass)) {
    return "actionClass must be 1–64 characters with no spaces";
  }
  if (!resourceGlob || resourceGlob.length > 200) {
    return "resourceGlob is required (max 200 chars)";
  }
  if (isUnboundedResourceGlob(resourceGlob)) {
    return "resourceGlob cannot be unbounded (* / **). Scope must name a path or object.";
  }
  if (risk !== "HIGH" && risk !== "CRITICAL") {
    return "risk must be HIGH or CRITICAL (LOW/MEDIUM are not approval-gated)";
  }
  const iterationFrom = Number(args.iterationFrom ?? job.iteration);
  const iterationTo = Number(args.iterationTo ?? job.maxIterations);
  if (!Number.isInteger(iterationFrom) || !Number.isInteger(iterationTo)) {
    return "iterationFrom/iterationTo must be integers";
  }
  if (iterationFrom < 0 || iterationTo < iterationFrom) {
    return "invalid iteration range";
  }
  return {
    id: randomUUID(),
    actionClass,
    resourceGlob,
    risk,
    label: label || `${risk} ${actionClass} ${resourceGlob}`,
    status: "pending",
    createdAt: Date.now(),
    iterationFrom,
    iterationTo,
  };
}

export function parseApproval(
  args: Record<string, unknown>,
  action: DeclaredAction,
  actor: string,
  now = Date.now()
): JobApproval | string {
  const breakGlass = args.breakGlass === true;
  if (action.risk === "CRITICAL" && !breakGlass) {
    return "CRITICAL actions require breakGlass: true on job_approve";
  }
  if (action.risk !== "CRITICAL" && breakGlass) {
    return "breakGlass is only valid for CRITICAL actions";
  }
  const expiresAt = Number(args.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return "expiresAt must be in the future";
  }
  return {
    id: randomUUID(),
    actionId: action.id,
    actionClass: action.actionClass,
    resourceGlob: action.resourceGlob,
    actor: actor.slice(0, 64),
    createdAt: now,
    expiresAt,
    iterationFrom: action.iterationFrom,
    iterationTo: action.iterationTo,
    breakGlass: breakGlass || undefined,
  };
}
