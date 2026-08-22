#!/usr/bin/env node
/**
 * Live Tier-1 smoke: ship-gate + secrets against prod MCP.
 *
 *   TOOLYOUR_API_KEY=ty_... node scripts/smoke-tier1-live.mjs
 *   Optional: MCP_URL (default https://api.toolyour.com/mcp/http)
 *             SHIP_URL (default https://example.com)
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
const shipUrl = process.env.SHIP_URL || "https://example.com";

if (!apiKey) {
  console.error("Set TOOLYOUR_API_KEY (or MCP_API_KEY)");
  process.exit(1);
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
    payload = dataLine ? JSON.parse(dataLine) : { raw: text.slice(0, 800) };
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
  if (payload?.error) return { error: payload.error };
  return payload;
}

function summarizeLoop(label, body) {
  const loop = body?.loop || body?.delta?.loop || {};
  const next = loop.nextActions?.[0] || body?.delta?.nextActions?.[0];
  console.log(`--- ${label} ---`);
  console.log(
    JSON.stringify(
      {
        status: body?.status,
        gate: loop.gate ?? body?.delta?.gate,
        initiate: loop.initiate,
        remainingFixes: loop.remainingFixes?.length ?? body?.delta?.remainingFixes?.length,
        rank1: next
          ? {
              label: next.label,
              patchType: next.patchType,
              roleHint: next.roleHint,
              hasAcceptance: Boolean(next.acceptance),
            }
          : null,
        receipt: loop.receipt
          ? {
              round: loop.receipt.round,
              estimatedCredits: loop.receipt.estimatedCredits,
            }
          : null,
        incomplete: body?.jobReport?.incomplete,
        roleHintDeployed: Boolean(next?.roleHint),
      },
      null,
      2
    )
  );
  return { loop, next };
}

async function main() {
  console.log("Tier-1 live smoke →", mcpHttp);

  const init = await rpc(
    null,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tier1-live-smoke", version: "1.0.0" },
    },
    0
  );
  assert(init.sessionId, "initialize returns mcp-session-id");
  let sid = init.sessionId;

  // --- Ship-gate ---
  const shipGoal = `ship gate for ${shipUrl}`;
  const planShip = await rpc(
    sid,
    "tools/call",
    { name: "plan_task", arguments: { goal: shipGoal } },
    1
  );
  sid = planShip.sessionId;
  const planShipBody = toolText(planShip.payload);
  assert(
    planShipBody?.status === "plan" || planShipBody?.free === true,
    "ship plan_task ok"
  );
  assert(planShipBody?.loop?.initiate !== false || planShipBody?.initiate !== false
    ? true
    : planShipBody?.loop?.initiate !== false,
    "ship plan usable"
  );

  const runShip = await rpc(
    sid,
    "tools/call",
    {
      name: "run_playbook",
      arguments: {
        skillId: "ship-gate",
        input: { url: shipUrl },
        responseMode: "compact",
      },
    },
    2
  );
  sid = runShip.sessionId;
  const shipBody = toolText(runShip.payload);
  assert(!shipBody?.error, `ship run_playbook failed: ${JSON.stringify(shipBody?.error || {}).slice(0, 200)}`);
  assert(
    shipBody?.status === "completed" || shipBody?.jobReport || shipBody?.loop,
    "ship-gate returned a usable result"
  );
  const shipSum = summarizeLoop("ship-gate", shipBody);
  assert(
    shipSum.loop?.gate === "fail" ||
      shipSum.loop?.gate === "pass" ||
      shipSum.loop?.gate === "unknown",
    `ship gate present (${shipSum.loop?.gate})`
  );

  // --- Secrets dirty ---
  const dirtyText =
    "STRIPE_KEY=sk_live_51ABCDEFdeadbeefxxxx\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n";
  const runSec = await rpc(
    sid,
    "tools/call",
    {
      name: "run_playbook",
      arguments: {
        skillId: "secrets-and-auth-hygiene",
        input: { text: dirtyText },
        responseMode: "compact",
      },
    },
    3
  );
  sid = runSec.sessionId;
  const secBody = toolText(runSec.payload);
  assert(!secBody?.error, `secrets error: ${JSON.stringify(secBody?.error || secBody).slice(0, 200)}`);
  const secSum = summarizeLoop("secrets-dirty", secBody);
  assert(
    (secSum.loop?.remainingFixes?.length || 0) >= 1 ||
      (secBody?.jobReport?.findings?.length || 0) >= 1,
    "secrets dirty paste produced findings/fixes"
  );
  assert(secSum.loop?.gate !== "pass", "secrets dirty must not gate=pass");

  // --- Secrets clean verify path (fresh run as "after") ---
  const cleanText = "APP_ENV=production\nLOG_LEVEL=info\n";
  const runClean = await rpc(
    sid,
    "tools/call",
    {
      name: "run_playbook",
      arguments: {
        skillId: "secrets-and-auth-hygiene",
        input: { text: cleanText },
        responseMode: "compact",
      },
    },
    4
  );
  sid = runClean.sessionId;
  const cleanBody = toolText(runClean.payload);
  const cleanSum = summarizeLoop("secrets-clean", cleanBody);
  assert(
    (cleanBody?.jobReport?.findings?.length || 0) === 0 ||
      cleanSum.loop?.gate === "pass" ||
      (cleanSum.loop?.remainingFixes?.length || 0) === 0,
    "secrets clean paste should be clean or pass"
  );

  const roleHintLive =
    Boolean(shipSum.next?.roleHint) || Boolean(secSum.next?.roleHint);
  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        mcpHttp,
        shipUrl,
        shipGate: shipSum.loop?.gate,
        shipRank1: shipSum.next?.label?.slice?.(0, 80) || shipSum.next?.label,
        shipRoleHint: shipSum.next?.roleHint || null,
        secretsDirtyFixes: secSum.loop?.remainingFixes?.length,
        secretsDirtyGate: secSum.loop?.gate,
        secretsCleanGate: cleanSum.loop?.gate,
        secretsCleanFixes: cleanSum.loop?.remainingFixes?.length,
        roleHintDeployedOnProd: roleHintLive,
        note: roleHintLive
          ? "Prod MCP includes roleHint (new host-contract deploy)."
          : "Prod MCP may still be on pre-roleHint build — deploy toolyour-mcp 959deef+.",
      },
      null,
      2
    )
  );
  console.log("PASS: Tier-1 live smoke finished");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
