#!/usr/bin/env node
/**
 * CI ship-gate via ToolYour MCP (poll-first; webhook not required).
 *
 *   TOOLYOUR_API_KEY=ty_... SHIP_URL=https://preview.example.com node scripts/ci-ship-gate.mjs
 *
 * Exit 0 when gate is pass (ship policy: no high findings / poor scores, and critical
 * TLS/headers/status/mixed scores are good). Exit 1 on fail / unknown / errors.
 * Exit 0 with SKIP if no key (local optional).
 *
 * Optional:
 *   MCP_URL=https://api.toolyour.com/mcp/http
 *   SHIP_GOAL="ship gate for https://..."
 *   REQUIRE_PASS=true (default) — set false to always exit 0 after printing report
 */
import "dotenv/config";
import {
  computeVerifyGate,
  extractJobReport,
} from "../dist/orchestrator/job-report.js";

const apiKey =
  process.env.TOOLYOUR_API_KEY ||
  process.env.MCP_API_KEY ||
  process.env.TY_API_KEY;
const shipUrl = process.env.SHIP_URL || process.env.PREVIEW_URL || "";
const mcpHttp = (
  process.env.MCP_URL ||
  "https://api.toolyour.com/mcp/http"
).replace(/\/$/, "");
const requirePass = (process.env.REQUIRE_PASS || "true").toLowerCase() !== "false";
const goal =
  process.env.SHIP_GOAL ||
  (shipUrl ? `ship gate for ${shipUrl}` : "");

if (!apiKey) {
  console.log("SKIP ci-ship-gate: set TOOLYOUR_API_KEY");
  process.exit(0);
}
if (!shipUrl || !goal) {
  console.error("Set SHIP_URL (or PREVIEW_URL) to the deploy URL to check");
  process.exit(1);
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    return dataLine ? JSON.parse(dataLine) : { raw: text.slice(0, 500) };
  }
}

function toolJson(payload) {
  const t = payload?.result?.content?.[0]?.text;
  if (typeof t === "string") {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return payload;
}

function resolveCiGate(solve, verify) {
  const status = String(verify?.status || solve?.status || "");
  if (status === "partial" || status === "error") return "fail";
  if (verify?.loop?.stop) return "fail";
  if (verify?.delta?.gate) return verify.delta.gate;
  if (solve?.loop?.gate) return solve.loop.gate;
  const report = extractJobReport(verify) || extractJobReport(solve);
  return computeVerifyGate(report);
}

async function main() {
  console.log("ci-ship-gate", { mcpHttp, shipUrl, goal });

  let sessionId = "";
  let id = 0;
  async function rpc(method, params) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Api-Key": apiKey,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(mcpHttp, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    sessionId = res.headers.get("mcp-session-id") || sessionId;
    const payload = parseBody(await res.text());
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`);
    }
    return payload;
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "toolyour-ci-ship-gate", version: "1.1.0" },
  });
  if (!sessionId) throw new Error("no mcp-session-id from initialize");

  await rpc("tools/call", {
    name: "plan_task",
    arguments: { goal, input: { url: shipUrl } },
  });

  const solvePayload = await rpc("tools/call", {
    name: "solve_task",
    arguments: {
      goal,
      input: { url: shipUrl },
      responseMode: "compact",
    },
  });
  const solve = toolJson(solvePayload);

  const verifyPayload = await rpc("tools/call", {
    name: "verify_task",
    arguments: {
      goal,
      input: { url: shipUrl },
      baseline: solve,
      responseMode: "compact",
    },
  });
  const verify = toolJson(verifyPayload);
  const gate = resolveCiGate(solve, verify);

  const fixes = verify?.delta?.remainingFixes || solve?.loop?.remainingFixes || [];
  const next = verify?.delta?.nextActions || solve?.loop?.nextActions || [];
  const report = extractJobReport(verify) || extractJobReport(solve);

  console.log(
    JSON.stringify(
      {
        gate,
        resultStatus: verify?.status || solve?.status,
        loopInitiate: verify?.loop?.initiate ?? solve?.loop?.initiate,
        loopStop: verify?.loop?.stop || null,
        round: verify?.loop?.round ?? solve?.loop?.round,
        gatePolicy: report?.gatePolicy || null,
        remainingFixes: fixes.slice(0, 5),
        nextActions: next.slice(0, 1),
        summary: verify?.delta?.summary || report?.summary,
      },
      null,
      2
    )
  );

  if (!requirePass) {
    console.log("REQUIRE_PASS=false — not failing the job");
    process.exit(0);
  }
  if (gate === "pass") {
    console.log("OK: ship-gate pass");
    process.exit(0);
  }
  console.error("FAIL: ship-gate gate=", gate);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
