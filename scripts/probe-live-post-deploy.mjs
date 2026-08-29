#!/usr/bin/env node
/**
 * One-off live probe against production MCP (uses Cursor mcp.json API key).
 * Does not print the key.
 */
import fs from "fs";
import path from "path";

function findKey() {
  const files = [
    path.join(process.env.USERPROFILE || "", ".cursor", "mcp.json"),
    "d:/Jourey/Products/toolyour/.cursor/mcp.json",
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const servers = j.mcpServers || j.servers || {};
    for (const [name, cfg] of Object.entries(servers)) {
      if (!/toolyour/i.test(name)) continue;
      const headers = cfg.headers || {};
      for (const [hk, hv] of Object.entries(headers)) {
        if (/api.?key/i.test(hk) && typeof hv === "string" && hv.startsWith("ty_"))
          return hv;
      }
      if (typeof cfg.env?.TOOLYOUR_API_KEY === "string") return cfg.env.TOOLYOUR_API_KEY;
      if (typeof cfg.env?.MCP_API_KEY === "string") return cfg.env.MCP_API_KEY;
    }
  }
  return null;
}

const apiKey = findKey();
if (!apiKey) {
  console.error("NO_KEY");
  process.exit(2);
}
console.log("KEY_OK len=" + apiKey.length);

const mcpHttp = "https://api.toolyour.com/mcp/http";

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
  return { sessionId: next, payload, status: res.status };
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

async function callTool(sessionId, name, args, id) {
  const r = await rpc(sessionId, "tools/call", { name, arguments: args }, id);
  return { sessionId: r.sessionId, result: toolText(r.payload), status: r.status };
}

const findings = [];
function note(name, ok, detail) {
  findings.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + " " + name + " :: " + detail);
}

const init = await rpc(
  null,
  "initialize",
  {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe-agent", version: "1.0" },
  },
  1
);
let sid = init.sessionId;
console.log("init status", init.status, "session", sid ? "yes" : "no");
await rpc(sid, "notifications/initialized", {}, 2);

{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    {
      goal: "ship gate for http://localhost:3000",
      input: { url: "http://localhost:3000" },
    },
    10
  );
  sid = sessionId;
  note(
    "plan_localhost_initiate_false",
    result?.loop?.initiate === false,
    "initiate=" + result?.loop?.initiate + " next=" + String(result?.next || "").slice(0, 140)
  );
}

{
  const { sessionId, result } = await callTool(sid, "plan_task", { goal: "tell me a joke" }, 11);
  sid = sessionId;
  note(
    "plan_joke_clean",
    result?.confidence === "none" && (result?.toolHints?.length || 0) === 0,
    "confidence=" + result?.confidence + " hints=" + (result?.toolHints?.length || 0)
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "solve_task",
    {
      goal: "ship gate for http://localhost:3000",
      input: { url: "http://localhost:3000" },
    },
    12
  );
  sid = sessionId;
  note(
    "solve_localhost_block",
    result?.status === "need_input" && result?.code === "local_preview_required",
    "status=" + result?.status + " code=" + result?.code
  );
}

{
  const { sessionId, result } = await callTool(sid, "verify_task", { goal: "ship gate" }, 13);
  sid = sessionId;
  note(
    "verify_need_baseline",
    result?.code === "need_baseline",
    "status=" + result?.status + " code=" + result?.code
  );
}

let ship;
{
  const { sessionId, result } = await callTool(
    sid,
    "run_playbook",
    {
      skillId: "ship-gate",
      input: { url: "https://example.com" },
      responseMode: "compact",
    },
    14
  );
  sid = sessionId;
  ship = result;
  note(
    "ship_gate_fail_honest",
    result?.loop?.gate === "fail" &&
      result?.loop?.nextActions?.length === 1 &&
      result?.execution?.jobReport?.gatePolicy === "ship",
    "gate=" +
      result?.loop?.gate +
      " nextActions=" +
      result?.loop?.nextActions?.length +
      " policy=" +
      result?.execution?.jobReport?.gatePolicy +
      " credits=" +
      result?.loop?.receipt?.estimatedCredits
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "verify_task",
    {
      goal: "ship gate for https://example.com",
      input: { url: "https://example.com" },
      baseline: ship,
      responseMode: "compact",
    },
    15
  );
  sid = sessionId;
  note(
    "verify_status_not_false_verified",
    result?.status !== "verified" || result?.loop?.gate === "pass",
    "status=" + result?.status + " gate=" + result?.loop?.gate + " initiate=" + result?.loop?.initiate
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "run_playbook",
    {
      skillId: "seo-site-audit",
      input: { url: "https://example.com" },
      responseMode: "compact",
    },
    16
  );
  sid = sessionId;
  const tech = result?.execution?.jobReport?.scores?.technicalSeo?.status;
  note(
    "seo_no_false_pass",
    result?.loop?.gate !== "pass" || tech === "good",
    "gate=" +
      result?.loop?.gate +
      " techSeo=" +
      tech +
      " incomplete=" +
      result?.execution?.jobReport?.incomplete
  );
}

{
  const secretText = [
    "API_KEY=sk_live_abc",
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI",
    'const token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sig";',
  ].join("\n");
  const { sessionId, result } = await callTool(
    sid,
    "run_playbook",
    {
      skillId: "pr-code-gate",
      input: { text: secretText },
      responseMode: "compact",
    },
    17
  );
  sid = sessionId;
  note(
    "secrets_gate_fail",
    result?.loop?.gate === "fail" && result?.loop?.initiate === true,
    "gate=" +
      result?.loop?.gate +
      " initiate=" +
      result?.loop?.initiate +
      " fixes=" +
      (result?.loop?.remainingFixes?.length || 0) +
      " policy=" +
      result?.execution?.jobReport?.gatePolicy
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "solve_task",
    {
      goal: "SEO audit for this HTML page",
      input: {
        html: "<!doctype html><html><head><title>x</title></head><body><h1>Hi</h1><img src='/a.png'></body></html>",
      },
      responseMode: "compact",
    },
    18
  );
  sid = sessionId;
  note(
    "local_seo_closable",
    result?.loop?.initiate === true && (result?.loop?.remainingFixes?.length || 0) > 0,
    "initiate=" +
      result?.loop?.initiate +
      " gate=" +
      result?.loop?.gate +
      " fixes=" +
      (result?.loop?.remainingFixes?.length || 0) +
      " hasJR=" +
      Boolean(result?.jobReport || result?.execution?.jobReport)
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "run_playbook",
    {
      skillId: "core-web-vitals",
      input: { url: "https://example.com" },
      responseMode: "compact",
    },
    19
  );
  sid = sessionId;
  note(
    "cwv_alias",
    result?.status !== "error" && result?.error?.code !== "skill_not_found",
    "status=" +
      result?.status +
      " skill=" +
      result?.skillId +
      " incomplete=" +
      result?.execution?.jobReport?.incomplete +
      " gate=" +
      result?.loop?.gate
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    {
      goal: "verify my preview deploy is production ready",
      input: { url: "https://example.com" },
    },
    20
  );
  sid = sessionId;
  note(
    "dev_verify_plan",
    result?.recommended?.id === "production-readiness-gate" &&
      Array.isArray(result?.goldenPath) &&
      result.goldenPath.length >= 5,
    "recommended=" +
      result?.recommended?.id +
      " goldenPath=" +
      (result?.goldenPath?.length || 0)
  );
}

let devRun;
{
  const { sessionId, result } = await callTool(
    sid,
    "run_playbook",
    {
      skillId: "production-readiness-gate",
      input: { url: "https://example.com" },
      responseMode: "compact",
    },
    21
  );
  sid = sessionId;
  devRun = result;
  note(
    "dev_verify_run_envelope",
    result?.verification?.schemaVersion === "toolyour.verification@1" &&
      (result?.verification?.evidence?.length || 0) > 0 &&
      Boolean(result?.verification?.profileId || result?.profileId),
    "evidence=" +
      (result?.verification?.evidence?.length || 0) +
      " profileId=" +
      (result?.verification?.profileId || result?.profileId || "missing")
  );
}

{
  const profileId = devRun?.verification?.profileId || devRun?.profileId;
  const { sessionId, result } = await callTool(
    sid,
    "verify_task",
    {
      goal: "verify my preview deploy is production ready",
      input: { url: "https://example.com", profileId },
      baseline: devRun,
      responseMode: "compact",
    },
    22
  );
  sid = sessionId;
  note(
    "dev_verify_task_delta",
    result?.delta?.gate !== "unknown" && result?.verification?.schemaVersion === "toolyour.verification@1",
    "status=" +
      result?.status +
      " delta.gate=" +
      result?.delta?.gate +
      " loop.gate=" +
      result?.loop?.gate
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    { goal: "build OCR for invoice PDFs in another project" },
    30
  );
  sid = sessionId;
  note(
    "feature_memory_record_keeping",
    result?.featureMemory?.recordKeeping?.policy === "toolyour_auto_record",
    "policy=" +
      (result?.featureMemory?.recordKeeping?.policy || "missing") +
      " domain=" +
      (result?.featureMemory?.domain || "n/a")
  );
}

{
  const { sessionId, result } = await callTool(sid, "list_feature_memory", { limit: 5 }, 31);
  sid = sessionId;
  note(
    "list_feature_memory_ok",
    result?.status === "ok" && Array.isArray(result?.features),
    "status=" + result?.status + " count=" + (result?.features?.length ?? "n/a")
  );
}

{
  const { sessionId, result } = await callTool(
    sid,
    "list_community_patterns",
    { domain: "ocr", limit: 5 },
    32
  );
  sid = sessionId;
  note(
    "list_community_patterns_ok",
    result?.status === "ok" && Array.isArray(result?.patterns),
    "status=" + result?.status + " count=" + (result?.patterns?.length ?? "n/a")
  );
}

{
  const tools = await rpc(sid, "tools/list", {}, 33);
  sid = tools.sessionId;
  const names = (tools.payload?.result?.tools || []).map((t) => t.name).sort();
  const required = [
    "capture_feature",
    "compare_feature_memory",
    "delete_feature",
    "list_community_patterns",
    "publish_feature_pattern",
    "unpublish_feature_pattern",
  ];
  const missing = required.filter((t) => !names.includes(t));
  note(
    "feature_memory_tools_registered",
    missing.length === 0,
    missing.length ? "missing=" + missing.join(",") : "all_present"
  );
}

const failed = findings.filter((f) => !f.ok);
console.log("\nSUMMARY pass=" + (findings.length - failed.length) + "/" + findings.length);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(" - " + f.name + ": " + f.detail);
}
process.exit(failed.length ? 1 : 0);
