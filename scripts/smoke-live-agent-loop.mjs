#!/usr/bin/env node
/**
 * Live smoke: plan_task → solve_task(compact) → verify_task (+ optional async get_run).
 * Webhook is NOT required.
 *
 *   MCP_API_KEY=ty_... node scripts/smoke-live-agent-loop.mjs
 *   # or TOOLYOUR_API_KEY
 *
 * Optional: MCP_URL (default https://api.toolyour.com/mcp/http)
 * Optional: SMOKE_URL (default https://example.com)
 */
import "dotenv/config";

const apiKey =
  process.env.MCP_API_KEY ||
  process.env.TOOLYOUR_API_KEY ||
  process.env.TY_API_KEY;
const mcpHttp = (
  process.env.MCP_URL ||
  "https://api.toolyour.com/mcp/http"
).replace(/\/$/, "");
const smokeUrl = process.env.SMOKE_URL || "https://example.com";
const goal = `check security headers for ${smokeUrl}`;

if (!apiKey) {
  console.log(
    "SKIP live smoke: set MCP_API_KEY or TOOLYOUR_API_KEY (webhook URL not required)."
  );
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

async function rpc(sessionId, method, params, id) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "X-Api-Key": apiKey,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(mcpHttp, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const next = res.headers.get("mcp-session-id") || sessionId;
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    payload = dataLine ? JSON.parse(dataLine) : { raw: text.slice(0, 500) };
  }
  return { sessionId: next, payload, ok: res.ok, status: res.status };
}

function toolText(payload) {
  const c = payload?.result?.content;
  if (Array.isArray(c) && c[0]?.text) {
    try {
      return JSON.parse(c[0].text);
    } catch {
      return c[0].text;
    }
  }
  return payload;
}

async function main() {
  console.log("Live smoke against", mcpHttp, "goal:", goal);
  console.log("(Webhook optional — not used in this smoke.)");

  const init = await rpc(null, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "toolyour-live-smoke", version: "1.0.0" },
  }, 0);
  assert(init.sessionId, "initialize returns mcp-session-id");

  let sid = init.sessionId;
  const plan = await rpc(
    sid,
    "tools/call",
    { name: "plan_task", arguments: { goal } },
    1
  );
  sid = plan.sessionId;
  const planBody = toolText(plan.payload);
  assert(planBody?.status === "plan" || planBody?.free === true, "plan_task returns plan");

  const solve = await rpc(
    sid,
    "tools/call",
    {
      name: "solve_task",
      arguments: { goal, input: { url: smokeUrl }, responseMode: "compact" },
    },
    2
  );
  sid = solve.sessionId;
  const solveBody = toolText(solve.payload);
  assert(
    solveBody &&
      (solveBody.status === "completed" ||
        solveBody.status === "partial" ||
        solveBody.execution ||
        solveBody.jobReport),
    `solve_task returned usable result (status=${solveBody?.status})`
  );

  const verify = await rpc(
    sid,
    "tools/call",
    {
      name: "verify_task",
      arguments: {
        goal,
        input: { url: smokeUrl },
        baseline: solveBody,
        responseMode: "compact",
      },
    },
    3
  );
  sid = verify.sessionId;
  const verifyBody = toolText(verify.payload);
  assert(
    verifyBody?.status === "verified" || verifyBody?.delta,
    "verify_task returns delta"
  );

  const asyncAccept = await rpc(
    sid,
    "tools/call",
    {
      name: "solve_task",
      arguments: {
        goal: `fix verify security headers for ${smokeUrl}`,
        input: { url: smokeUrl },
        responseMode: "compact",
        async: true,
      },
    },
    4
  );
  sid = asyncAccept.sessionId;
  const accepted = toolText(asyncAccept.payload);
  assert(accepted?.status === "accepted" && accepted?.runId, "async accept runId");
  assert(accepted?.webhookOptional === true, "webhook marked optional");

  let final = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await rpc(
      sid,
      "tools/call",
      { name: "get_run", arguments: { runId: accepted.runId } },
      100 + i
    );
    sid = poll.sessionId;
    const body = toolText(poll.payload);
    if (
      body?.status === "completed" ||
      body?.status === "partial" ||
      body?.status === "error"
    ) {
      final = body;
      break;
    }
  }
  assert(final, "get_run eventually returns terminal status (no webhook needed)");

  console.log("\nAll live smoke checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
