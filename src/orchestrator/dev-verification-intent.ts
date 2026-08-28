/**
 * Detect development / production-readiness intents for plan_task golden paths.
 */
export function isDevelopmentVerificationGoal(goal: string): boolean {
  const g = goal.trim().toLowerCase();
  if (!g) return false;

  // PR / workspace payload goals — not live URL verification
  if (/\b(ship this pr|pr before merge|before merge this pr)\b/i.test(g)) {
    return false;
  }
  if (/\bpr\b/i.test(g) && /\b(before merge|code review|diff)\b/i.test(g) && !/\bpreview\b/i.test(g)) {
    return false;
  }

  return (
    /\b(production[\s-]?ready|prod[\s-]?ready|ready for production|ready to deploy)\b/i.test(
      g
    ) ||
    /\b(verify (my |the )?(preview|deploy|deployment|staging))\b/i.test(g) ||
    /\b(preview (deploy|url|gate)|pr preview)\b/i.test(g) ||
    /\b(make (this |the )?(app|site|application) (production|deploy))\b/i.test(g) ||
    /\bpre[\s-]?deploy\b/i.test(g)
  );
}

export const DEV_VERIFICATION_GOLDEN_PATH = [
  "Ensure a public https:// preview URL (deploy or tunnel) — not localhost",
  "plan_task(goal) — free; read loop.initiate",
  "run_playbook('production-readiness-gate' or 'ship-gate', { url, profileId? })",
  "Apply ONLY loop.nextActions[0] in the host workspace",
  "Redeploy preview if headers/config changed",
  "verify_task(goal, { url, profileId }, baseline=<entire prior result>)",
  "Repeat until loop.gate=pass or loop.stop",
];

export function developmentVerificationPlanNext(urlHint?: string): string {
  const urlPart = urlHint ? ` for ${urlHint}` : "";
  return (
    `Development verification${urlPart}: run_playbook("production-readiness-gate", { url }) then verify_task after each host fix. ` +
    `Read verification.evidence and loop.line first. profileId auto-created when url is https. ` +
    `Do not invoke_tool for the same job.`
  );
}
