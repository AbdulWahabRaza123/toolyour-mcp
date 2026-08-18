#!/usr/bin/env node
/**
 * Fixture-cwd wrapper so a fixture-only Cursor workspace can still invoke the host runner.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(fixture, "..", "..");
const host = path.join(mcpRoot, "scripts", "control-plane-host.mjs");
const jobIdx = process.argv.indexOf("--job");
const jobId = jobIdx >= 0 ? process.argv[jobIdx + 1] : "";
if (!jobId) {
  console.error("usage: node run-checks.mjs --job <id>");
  process.exit(2);
}

const child = spawn(
  process.execPath,
  [host, "--job", jobId, "--cwd", fixture],
  {
    cwd: mcpRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  }
);
child.on("close", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
