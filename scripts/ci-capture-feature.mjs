#!/usr/bin/env node
/**
 * CI feature-memory capture via ToolYour MCP capture_feature.
 *
 *   TOOLYOUR_API_KEY=ty_... FEATURE_TITLE="Stock OCR" FEATURE_REQUIREMENTS="..." \
 *     node scripts/ci-capture-feature.mjs
 *
 * Optional:
 *   MCP_URL=https://api.toolyour.com/mcp/http
 *   FEATURE_DOMAIN=ocr
 *   PROJECT_NAME=my-app
 *   BASELINE_FILE=./verify-result.json  — prior verify_task / run_playbook JSON
 *   SUPERSEDES_FEATURE_ID=fm_…
 *   REQUIRE_CAPTURE=true (default) — exit 1 on capture failure
 */
import "dotenv/config";
import fs from "node:fs";

const apiKey =
  process.env.TOOLYOUR_API_KEY ||
  process.env.MCP_API_KEY ||
  process.env.TY_API_KEY;
const mcpHttp = (
  process.env.MCP_URL ||
  "https://api.toolyour.com/mcp/http"
).replace(/\/$/, "");
const title = process.env.FEATURE_TITLE || process.env.CI_FEATURE_TITLE || "";
const requirements =
  process.env.FEATURE_REQUIREMENTS || process.env.CI_FEATURE_REQUIREMENTS || title;
const domain = process.env.FEATURE_DOMAIN || undefined;
const projectName = process.env.PROJECT_NAME || process.env.GITHUB_REPOSITORY || undefined;
const supersedesFeatureId = process.env.SUPERSEDES_FEATURE_ID || undefined;
const baselineFile = process.env.BASELINE_FILE || process.env.CI_BASELINE_FILE || "";
const requireCapture =
  (process.env.REQUIRE_CAPTURE || "true").toLowerCase() !== "false";

if (!apiKey) {
  console.log("SKIP ci-capture-feature: set TOOLYOUR_API_KEY");
  process.exit(0);
}
if (!title.trim()) {
  console.error("Set FEATURE_TITLE (or CI_FEATURE_TITLE)");
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

function loadBaseline() {
  if (!baselineFile) return undefined;
  const raw = fs.readFileSync(baselineFile, "utf8");
  return JSON.parse(raw);
}

async function main() {
  console.log("ci-capture-feature", { mcpHttp, title, domain: domain || "auto" });

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
    clientInfo: { name: "toolyour-ci-capture-feature", version: "1.0.0" },
  });
  if (!sessionId) throw new Error("no mcp-session-id from initialize");

  const baseline = loadBaseline();
  const capturePayload = await rpc("tools/call", {
    name: "capture_feature",
    arguments: {
      title,
      requirements,
      domain,
      projectName,
      baseline,
      supersedesFeatureId,
      event: "verified",
    },
  });
  const captured = toolJson(capturePayload);

  console.log(
    JSON.stringify(
      {
        status: captured?.status,
        featureId: captured?.feature?.featureId,
        domain: captured?.feature?.domain,
        compositeScore: captured?.compositeScore ?? captured?.feature?.compositeScore,
        matrixComparison: captured?.matrixComparison?.status,
      },
      null,
      2
    )
  );

  if (captured?.status === "captured" || captured?.status === "updated") {
    console.log("OK: feature memory captured");
    process.exit(0);
  }

  console.error("FAIL: capture_feature status=", captured?.status || "unknown");
  process.exit(requireCapture ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
