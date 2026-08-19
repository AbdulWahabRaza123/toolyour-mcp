import type { CheckKind } from "./types";

/** Frozen experiment commands stay exact-match in mcp.ts ALLOWED_COMMANDS. */
const PLAYWRIGHT_PATH = /^[A-Za-z0-9._/-]+$/;
const PLAYWRIGHT_FLAG = /^(?:--reporter=line|--reporter=list|--project=[A-Za-z0-9._-]+)$/;

/**
 * Host-only Playwright. ToolYour never launches a browser.
 * npx playwright test [spec path…] [--reporter=line|list] [--project=name]
 */
export function isPlaywrightCheckCommand(command: string): boolean {
  const parts = String(command || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 3) return false;
  if (parts[0] !== "npx" || parts[1] !== "playwright" || parts[2] !== "test") {
    return false;
  }
  for (const token of parts.slice(3)) {
    if (token.includes("..")) return false;
    if (PLAYWRIGHT_FLAG.test(token)) continue;
    if (PLAYWRIGHT_PATH.test(token) && !token.startsWith("-")) continue;
    return false;
  }
  return true;
}

export function isAllowedCheckCommand(command: string, kind: CheckKind, exact: Set<string>): boolean {
  if (kind === "playwright") return isPlaywrightCheckCommand(command);
  return exact.has(command);
}

export function checkTimeoutMs(
  kind: string,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (kind === "playwright") {
    const n = Number(env.CONTROL_PLANE_PLAYWRIGHT_TIMEOUT_MS || 120_000);
    return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 600_000) : 120_000;
  }
  const n = Number(env.CONTROL_PLANE_CHECK_TIMEOUT_MS || 30_000);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 300_000) : 30_000;
}
