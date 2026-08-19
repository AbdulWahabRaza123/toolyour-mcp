#!/usr/bin/env node
/**
 * Print PowerShell env for a local control-plane session.
 * Tokens are random; do not commit them.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const start = randomBytes(24).toString("hex");
const runner = randomBytes(24).toString("hex");
const secrets = path.join(os.tmpdir(), "toolyour-control-plane");

const lines = [
  `$env:MCP_API_KEY="ty_experiment"`,
  `$env:CONTROL_PLANE_START_TOKEN="${start}"`,
  `$env:CONTROL_PLANE_RUNNER_TOKEN="${runner}"`,
  `$env:CONTROL_PLANE_SECRETS_DIR="${secrets}"`,
];

console.log(lines.join("\n"));
console.log("");
console.log("# Paste the block above into BOTH the MCP server terminal and the start/host terminal.");
console.log("# Then: npm run build; node dist/server.js");
console.log("# Other terminal: node scripts/control-plane-reset-fixture.mjs");
console.log("#                 node scripts/control-plane-start-job.mjs --task 1");
