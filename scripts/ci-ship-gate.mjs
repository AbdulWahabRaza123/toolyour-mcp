#!/usr/bin/env node
/**
 * CI ship-gate via ToolYour MCP (poll-first; webhook not required).
 *
 *   TOOLYOUR_API_KEY=ty_... SHIP_URL=https://preview.example.com node scripts/ci-ship-gate.mjs
 *
 * Exit 0 when gate is pass (no high findings / poor scores on jobReport, or verify delta.gate=pass).
 * Exit 1 on fail / errors. Exit 0 with SKIP if no key (local optional).
 *
 * Optional:
 *   MCP_URL=https://api.toolyour.com/mcp/http
 *   SHIP_GOAL="ship gate for https://..."
 *   REQUIRE_PASS=true (default) — set false to always exit 0 after printing report
 */
import "dotenv/config";

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

function extractReport(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.schemaVersion === "toolyour.jobReport@1") return payload;
  if (payload.jobReport) return payload.jobReport;
  if (payload.execution?.jobReport) return payload.execution.jobReport;
  if (payload.after) return extractReport(payload.after);
  if (payload.result) return extractReport(payload.result);
  return null;
}

function gateFromReport(report) {
  if (!report) return "unknown";
  const high = (report.findings || []).some((f) => f.severity === "high");
  const poor = Object.values(report.scores || {}).some(
    (s) => s && s.status === "poor"
  );
  if (high || poor) return "fail";
  return "pass";
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
    clientInfo: { name: "toolyour-ci-ship-gate", version: "1.0.0" },
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
  const report = extractReport(solve);
  let gate =
    solve?.delta?.gate ||
    gateFromReport(report);

  // Optional verify against self as baseline for remainingFixes shape
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
  if (verify?.delta?.gate) gate = verify.delta.gate;

  const fixes = verify?.delta?.remainingFixes || [];
  const next = verify?.delta?.nextActions || [];

  console.log(
    JSON.stringify(
      {
        gate,
        resultStatus: verify?.status || solve?.status,
        remainingFixes: fixes.slice(0, 5),
        nextActions: next.slice(0, 5),
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
