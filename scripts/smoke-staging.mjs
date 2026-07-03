#!/usr/bin/env node
/**
 * Staging smoke — requires MCP_URL and MCP_API_KEY env vars.
 */
const base = (process.env.MCP_URL || "http://127.0.0.1:3090").replace(/\/$/, "");
const apiKey = process.env.MCP_API_KEY;

if (!apiKey) {
  console.log("SKIP smoke: set MCP_API_KEY");
  process.exit(0);
}

async function main() {
  const health = await fetch(`${base}/health/mcp`);
  assertOk(health.ok, "health/mcp");

  const ready = await fetch(`${base}/health/mcp/ready`);
  console.log("ready", ready.status, await ready.json());
}

function assertOk(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
