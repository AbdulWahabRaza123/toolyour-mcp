#!/usr/bin/env node
/**
 * Live Feature Memory E2E against production MCP.
 * Uses API key from `.cursor/mcp.json` — does not print the key.
 *
 * Env:
 *   FM_TEST_PUBLISH=true   — publish probe feature to community (default: false)
 *   FM_PROBE_PREFIX=...    — title prefix for probe captures (default: "FM probe OCR invoices")
 *   FM_TEST_CLEANUP=true   — delete probe captures matching FM_PROBE_PREFIX after run
 */
import fs from "fs";
import path from "path";

const probePrefix = process.env.FM_PROBE_PREFIX || "FM probe OCR invoices";
const testPublish = (process.env.FM_TEST_PUBLISH || "false").toLowerCase() === "true";
const testCleanup = (process.env.FM_TEST_CLEANUP || "false").toLowerCase() === "true";

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
    }
  }
  return null;
}

const apiKey = findKey();
if (!apiKey) {
  console.error("NO_KEY in .cursor/mcp.json");
  process.exit(2);
}

const mcpHttp = process.env.MCP_URL || "https://api.toolyour.com/mcp/http";
const stamp = Date.now();
const testTitle = `${probePrefix} ${stamp}`;

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

async function callToolRetry(sessionId, name, args, id, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await callTool(sessionId, name, args, id * 10 + i);
    sessionId = last.sessionId;
    const ok =
      (name === "list_feature_memory" && last.result?.status === "ok") ||
      (name === "list_community_patterns" && last.result?.status === "ok") ||
      (name === "capture_feature" &&
        (last.result?.status === "captured" || last.result?.status === "recorded")) ||
      (name === "delete_feature" && last.result?.status === "deleted");
    if (ok) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

const findings = [];
function note(name, ok, detail) {
  findings.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + " " + name);
  console.log("  " + detail);
}

let sid;
const init = await rpc(
  null,
  "initialize",
  {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "fm-test", version: "1.0" },
  },
  1
);
sid = init.sessionId;
await rpc(sid, "notifications/initialized", {}, 2);

console.log("fm-test publish=" + testPublish + " prefix=" + probePrefix);

// 1. plan_task envelope before any captures
{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    { goal: "build OCR for invoice PDFs in another project" },
    10
  );
  sid = sessionId;
  const fm = result?.featureMemory;
  note(
    "plan_task_record_keeping",
    fm?.recordKeeping?.policy === "toolyour_auto_record" &&
      fm?.schemaVersion === "toolyour.featureMemory@1",
    `policy=${fm?.recordKeeping?.policy} domain=${fm?.domain} goldenPath=${fm?.goldenPath?.length ?? 0}`
  );
}

// 2. list baseline
let baselineCount = 0;
{
  const { sessionId, result } = await callToolRetry(sid, "list_feature_memory", { limit: 50 }, 11);
  sid = sessionId;
  baselineCount = result?.features?.length ?? -1;
  note(
    "list_feature_memory",
    result?.status === "ok" && Array.isArray(result?.features),
    `status=${result?.status} count=${baselineCount}`
  );
}

// 3. capture_feature (manual refine path → SaaS persistence)
let featureId;
{
  const { sessionId, result } = await callToolRetry(
    sid,
    "capture_feature",
    {
      title: testTitle,
      requirements:
        "Extract vendor, date, total from invoice PDFs; support batch upload; return JSON per file.",
      domain: "ocr",
      projectName: "fm-probe-project",
      outcomesSummary: "Live MCP probe capture",
    },
    12
  );
  sid = sessionId;
  featureId = result?.feature?.featureId || result?.featureId;
  note(
    "capture_feature",
    (result?.status === "recorded" || result?.status === "captured") &&
      typeof featureId === "string" &&
      featureId.startsWith("fm_"),
    `status=${result?.status} featureId=${featureId || "missing"} composite=${result?.feature?.compositeScore ?? result?.compositeScore ?? "n/a"}`
  );
}

// 4. list after capture
{
  const { sessionId, result } = await callToolRetry(sid, "list_feature_memory", { domain: "ocr", limit: 50 }, 13);
  sid = sessionId;
  const found = (result?.features || []).some((f) => f.featureId === featureId);
  const count = result?.features?.length ?? 0;
  note(
    "list_after_capture",
    result?.status === "ok" && found && count >= baselineCount,
    `count=${count} found=${found} baseline=${baselineCount}`
  );
}

// 5. plan_task should surface prior match
{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    { goal: "add OCR for invoice PDFs in a new SaaS project" },
    14
  );
  sid = sessionId;
  const fm = result?.featureMemory;
  const hasPrior =
    (fm?.priorInstances?.length ?? 0) > 0 ||
    fm?.bestKnown?.featureId === featureId ||
    (fm?.matchConfidence && fm.matchConfidence !== "none");
  note(
    "plan_task_prior_match",
    hasPrior,
    `matchConfidence=${fm?.matchConfidence} prior=${fm?.priorInstances?.length ?? 0} bestKnown=${fm?.bestKnown?.featureId ?? "none"} reminder=${Boolean(fm?.reminder)}`
  );
}

// 6. compare_feature_memory (self vs self is ok for API smoke)
if (featureId) {
  const { sessionId, result } = await callTool(
    sid,
    "compare_feature_memory",
    { featureIdA: featureId, featureIdB: featureId },
    15
  );
  sid = sessionId;
  const dimCount = result?.matrixComparison?.dimensionDeltas?.length ?? 0;
  note(
    "compare_feature_memory",
    result?.status === "ok" && result?.matrixComparison,
    `status=${result?.status} compositeDelta=${result?.compositeDelta ?? "n/a"} dims=${dimCount}`
  );
}

// 7. publish to community + list (opt-in via FM_TEST_PUBLISH)
let published = false;
if (featureId && testPublish) {
  const { sessionId, result } = await callTool(
    sid,
    "publish_feature_pattern",
    { featureId },
    16
  );
  sid = sessionId;
  published = result?.status === "published";
  note(
    "publish_feature_pattern",
    published,
    `status=${result?.status}`
  );
} else {
  note(
    "publish_feature_pattern",
    true,
    testPublish ? "skipped (no featureId)" : "skipped (set FM_TEST_PUBLISH=true to test)"
  );
}

{
  const { sessionId, result } = await callToolRetry(
    sid,
    "list_community_patterns",
    { domain: "ocr", limit: 20 },
    17
  );
  sid = sessionId;
  const patterns = result?.patterns || [];
  const sawOurs = published && patterns.some((p) => p.featureId === featureId);
  note(
    "list_community_patterns",
    result?.status === "ok" && Array.isArray(patterns) && (!published || sawOurs),
    `status=${result?.status} count=${patterns.length} sawPublished=${sawOurs}`
  );
}

// 8. opt-out flag on plan (capture=false should still return recordKeeping)
{
  const { sessionId, result } = await callTool(
    sid,
    "plan_task",
    {
      goal: "build payment webhook handler",
      input: { featureMemory: { capture: false } },
    },
    18
  );
  sid = sessionId;
  note(
    "plan_task_opt_out_still_envelope",
    result?.featureMemory?.recordKeeping?.policy === "toolyour_auto_record",
    `policy=${result?.featureMemory?.recordKeeping?.policy}`
  );
}

// 9. tools registered
{
  const tools = await rpc(sid, "tools/list", {}, 19);
  sid = tools.sessionId;
  const names = (tools.payload?.result?.tools || []).map((t) => t.name);
  const required = [
    "capture_feature",
    "delete_feature",
    "list_feature_memory",
    "compare_feature_memory",
    "publish_feature_pattern",
    "unpublish_feature_pattern",
    "list_community_patterns",
  ];
  const missing = required.filter((t) => !names.includes(t));
  note(
    "tools_registered",
    missing.length === 0,
    missing.length ? `missing=${missing.join(",")}` : `all ${required.length} present`
  );
}

// 10. auto-record on verify gate pass (local HTML SEO closable job)
{
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><title>Invoice OCR Landing</title>
<meta name="description" content="OCR for invoice PDFs">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Invoice OCR">
<meta property="og:description" content="OCR for invoice PDFs">
<meta name="twitter:card" content="summary">
</head><body><h1>Invoice OCR</h1><p>Extract data from PDF invoices.</p></body></html>`;

  const run = await callTool(
    sid,
    "solve_task",
    {
      goal: "build SEO for invoice OCR landing page HTML",
      input: { html, featureTitle: `FM auto-record probe ${stamp}` },
    },
    20
  );
  sid = run.sessionId;
  const gate = run.result?.loop?.gate;
  note(
    "solve_local_html_seo",
    run.result?.loop?.initiate === true && Boolean(run.result?.execution?.jobReport),
    `gate=${gate} fixes=${run.result?.loop?.remainingFixes?.length ?? 0}`
  );

  const verify = await callTool(
    sid,
    "verify_task",
    {
      goal: "build SEO for invoice OCR landing page HTML",
      baseline: run.result,
      input: { html, featureTitle: `FM auto-record probe ${stamp}` },
    },
    21
  );
  sid = verify.sessionId;
  const rec = verify.result?.featureMemoryRecord;
  const verifyGate = verify.result?.loop?.gate ?? gate;
  if (verifyGate === "pass") {
    note(
      "auto_record_on_verify_pass",
      rec?.status === "recorded" && typeof rec?.featureId === "string",
      `verifyGate=${verifyGate} featureId=${rec?.featureId ?? "none"} policy=${rec?.policy ?? "n/a"}`
    );
  } else {
    note(
      "auto_record_on_verify_pass",
      !rec?.featureId,
      `skipped (gate=${verifyGate}) — auto-record only fires on loop.gate=pass`
    );
  }
}

// 11. optional cleanup of probe captures
if (testCleanup) {
  const { sessionId, result } = await callToolRetry(sid, "list_feature_memory", { limit: 100 }, 22);
  sid = sessionId;
  const probes = (result?.features || []).filter((f) =>
    String(f.title || "").startsWith(probePrefix)
  );
  let removed = 0;
  for (const f of probes) {
    const del = await callToolRetry(sid, "delete_feature", { featureId: f.featureId }, 23 + removed);
    sid = del.sessionId;
    if (del.result?.status === "deleted") removed += 1;
  }
  note(
    "cleanup_probe_features",
    true,
    `prefix="${probePrefix}" removed=${removed} matched=${probes.length}`
  );
}

const failed = findings.filter((f) => !f.ok);
console.log("\n=== FEATURE MEMORY LIVE TEST ===");
console.log("pass=" + (findings.length - failed.length) + "/" + findings.length);
if (featureId) console.log("testFeatureId=" + featureId);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(" - " + f.name + ": " + f.detail);
}
process.exit(failed.length ? 1 : 0);
