import type { RemainingFix, VerifyGate } from "./job-report";

/** Default cap on verify_task rounds (solve = round 0). */
export const DEFAULT_MAX_VERIFY_ROUNDS = 5;

/** Stop when the same remaining-finding set repeats this many times in a row. */
export const DEFAULT_SAME_FINDINGS_LIMIT = 2;

export type LoopStopCode = "max_rounds" | "same_findings";

export interface LoopStop {
  code: LoopStopCode;
  message: string;
}

export interface LoopProgress {
  /** 0 = first solve/run_playbook; each verify_task increments by 1. */
  round: number;
  maxRounds: number;
  findingFingerprint: string;
  sameFindingsStreak: number;
  sameFindingsLimit: number;
  stop?: LoopStop;
}

export const LOOP_MAX_ROUNDS =
  "Max verify rounds reached without gate pass. Stop the harness loop and escalate to a human — do not call verify_task again for this job.";

export const LOOP_SAME_FINDINGS =
  "Same remaining findings after verify (no progress). Stop the harness loop and escalate to a human — do not call verify_task again for this job.";

export function fingerprintFromFixes(fixes: RemainingFix[]): string {
  const ids = fixes
    .map((f) =>
      String(f.findingId || `${f.workstream || ""}|${f.title || ""}`)
        .toLowerCase()
        .trim()
    )
    .filter(Boolean)
    .sort();
  return ids.length ? ids.join("|") : "empty";
}

export function extractLoopProgress(payload: unknown): LoopProgress | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const loop = root.loop;
  if (loop && typeof loop === "object") {
    const p = progressFromPartial(loop as Record<string, unknown>);
    if (p) return p;
  }
  if (root.after !== undefined) {
    const nested = extractLoopProgress(root.after);
    if (nested) return nested;
  }
  if (root.result !== undefined) {
    const nested = extractLoopProgress(root.result);
    if (nested) return nested;
  }
  return null;
}

function progressFromPartial(
  loop: Record<string, unknown>
): LoopProgress | null {
  if (typeof loop.round !== "number" && typeof loop.findingFingerprint !== "string") {
    return null;
  }
  const round = typeof loop.round === "number" ? loop.round : 0;
  const maxRounds =
    typeof loop.maxRounds === "number"
      ? loop.maxRounds
      : DEFAULT_MAX_VERIFY_ROUNDS;
  const findingFingerprint =
    typeof loop.findingFingerprint === "string"
      ? loop.findingFingerprint
      : "empty";
  const sameFindingsStreak =
    typeof loop.sameFindingsStreak === "number" ? loop.sameFindingsStreak : 0;
  const sameFindingsLimit =
    typeof loop.sameFindingsLimit === "number"
      ? loop.sameFindingsLimit
      : DEFAULT_SAME_FINDINGS_LIMIT;
  let stop: LoopStop | undefined;
  if (loop.stop && typeof loop.stop === "object") {
    const s = loop.stop as Record<string, unknown>;
    if (s.code === "max_rounds" || s.code === "same_findings") {
      stop = {
        code: s.code,
        message: String(s.message || ""),
      };
    }
  }
  return {
    round,
    maxRounds,
    findingFingerprint,
    sameFindingsStreak,
    sameFindingsLimit,
    stop,
  };
}

/**
 * Initial progress for a first solve / run_playbook result.
 */
export function initialLoopProgress(fixes: RemainingFix[]): LoopProgress {
  return {
    round: 0,
    maxRounds: DEFAULT_MAX_VERIFY_ROUNDS,
    findingFingerprint: fingerprintFromFixes(fixes),
    sameFindingsStreak: 0,
    sameFindingsLimit: DEFAULT_SAME_FINDINGS_LIMIT,
  };
}

/**
 * Advance progress for a verify_task result vs the baseline payload.
 */
export function advanceLoopProgress(opts: {
  baseline: unknown;
  remainingFixes: RemainingFix[];
  gate: VerifyGate;
  deltaStatus?: string;
}): LoopProgress {
  const prev = extractLoopProgress(opts.baseline);
  const maxRounds = prev?.maxRounds ?? DEFAULT_MAX_VERIFY_ROUNDS;
  const sameFindingsLimit =
    prev?.sameFindingsLimit ?? DEFAULT_SAME_FINDINGS_LIMIT;
  const round = (prev?.round ?? 0) + 1;
  const findingFingerprint = fingerprintFromFixes(opts.remainingFixes);
  const prevFp = prev?.findingFingerprint ?? "";
  const stalled =
    opts.gate === "fail" &&
    findingFingerprint !== "empty" &&
    findingFingerprint === prevFp &&
    (opts.deltaStatus === "unchanged" || opts.deltaStatus === "regressed" || !opts.deltaStatus);

  const sameFindingsStreak = stalled
    ? (prev?.sameFindingsStreak ?? 0) + 1
    : 0;

  let stop: LoopStop | undefined;
  if (opts.gate === "fail" && sameFindingsStreak >= sameFindingsLimit) {
    stop = { code: "same_findings", message: LOOP_SAME_FINDINGS };
  } else if (opts.gate === "fail" && round >= maxRounds) {
    stop = { code: "max_rounds", message: LOOP_MAX_ROUNDS };
  }

  return {
    round,
    maxRounds,
    findingFingerprint,
    sameFindingsStreak,
    sameFindingsLimit,
    stop,
  };
}
