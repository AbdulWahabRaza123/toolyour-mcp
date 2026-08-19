#!/usr/bin/env node
/**
 * Scripted (no LLM) proof of the control-plane experiment loop.
 *
 *   npm run build
 *   node scripts/eval-control-plane.mjs
 *
 * Spawns a local MCP with both loops registered (catalog + job tools).
 * Does not read MCP_URL (stale shells broke eval). Override only with
 * --mcp-url or CONTROL_PLANE_EVAL_MCP_URL.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const fixture = path.join(root, "experiments", "control-plane-fixture");
const operator = path.join(root, "experiments", "control-plane-operator");
const hostScript = path.join(root, "scripts", "control-plane-host.mjs");
const resetScript = path.join(root, "scripts", "control-plane-reset-fixture.mjs");
const apiKey = process.env.MCP_API_KEY || process.env.TOOLYOUR_API_KEY || "ty_experiment";

let failed = 0;
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function bad(msg) {
  failed++;
  console.error(`✗ ${msg}`);
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(base, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health/mcp`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`MCP health timeout at ${base}`);
}

function makeRpc(mcpHttp) {
  let sessionId = "";
  let id = 0;
  return async function rpc(method, params) {
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
    return toolJson(payload);
  };
}

function copyFile(from, to) {
  fs.copyFileSync(from, to);
}

function resetFixtureNow() {
  const r = spawnSync(process.execPath, [resetScript], { cwd: root, windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`reset fixture failed: ${r.stderr || r.stdout}`);
  }
}

async function runHost(jobId, mcpHttp) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [hostScript, "--job", jobId, "--cwd", fixture],
      {
        cwd: root,
        env: {
          ...process.env,
          MCP_URL: mcpHttp,
          MCP_API_KEY: apiKey,
          CONTROL_PLANE_RUNNER_TOKEN: runnerToken,
          CONTROL_PLANE_SECRETS_DIR: process.env.CONTROL_PLANE_SECRETS_DIR,
        },
        windowsHide: true,
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      const decisionPath = path.join(fixture, "DECISION.json");
      let decision = null;
      if (fs.existsSync(decisionPath)) {
        decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
      }
      if (code !== 0 && !decision) {
        reject(new Error(`host runner exit ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(decision);
    });
  });
}

const runnerToken = ensureToken("CONTROL_PLANE_RUNNER_TOKEN");
const startToken = ensureToken("CONTROL_PLANE_START_TOKEN");

function ensureToken(name) {
  const cur = String(process.env[name] || "").trim();
  if (cur.length >= 16) return cur;
  const generated = randomBytes(24).toString("hex");
  process.env[name] = generated;
  return generated;
}

function nonceFor(jobId) {
  const dir = process.env.CONTROL_PLANE_SECRETS_DIR;
  const file = path.join(dir, `${jobId}.nonce`);
  if (!fs.existsSync(file)) throw new Error(`nonce missing for ${jobId} at ${file}`);
  return fs.readFileSync(file, "utf8").trim();
}

function submitAuth(jobId) {
  return { jobId, runnerToken, runnerNonce: nonceFor(jobId) };
}

function leakKeys(payload) {
  const raw = JSON.stringify(payload);
  return ["runnerNonce", "runnerNonceHash", "startToken", "runnerToken"].filter((k) =>
    new RegExp(`"${k}"\\s*:`).test(raw)
  );
}

async function main() {
  const mcpUrlFlag = arg("--mcp-url") || process.env.CONTROL_PLANE_EVAL_MCP_URL || "";
  const spawned = !mcpUrlFlag;
  const port = process.env.CONTROL_PLANE_EVAL_PORT || "13090";
  const mcpBase = spawned
    ? `http://127.0.0.1:${port}`
    : mcpUrlFlag.replace(/\/mcp\/http$/, "").replace(/\/$/, "");
  const mcpHttp = spawned ? `${mcpBase}/mcp/http` : mcpUrlFlag.replace(/\/$/, "");

  let child;
  const dataDir = path.join(root, ".data", "control-plane-eval");
  const secretsDir = path.join(dataDir, "secrets");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(secretsDir, { recursive: true });
  process.env.CONTROL_PLANE_SECRETS_DIR = secretsDir;
  process.env.CONTROL_PLANE_START_TOKEN = startToken;
  process.env.CONTROL_PLANE_RUNNER_TOKEN = runnerToken;

  if (mcpUrlFlag) {
    if (!String(process.env.CONTROL_PLANE_START_TOKEN || "").trim() ||
        !String(process.env.CONTROL_PLANE_RUNNER_TOKEN || "").trim()) {
      throw new Error("when using --mcp-url, set CONTROL_PLANE_START_TOKEN and CONTROL_PLANE_RUNNER_TOKEN to match the server");
    }
  }

  if (spawned) {
    child = spawn(process.execPath, ["dist/server.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        CONTROL_PLANE_DATA_DIR: dataDir,
        CONTROL_PLANE_SECRETS_DIR: secretsDir,
        CONTROL_PLANE_START_TOKEN: startToken,
        CONTROL_PLANE_RUNNER_TOKEN: runnerToken,
        LOG_LEVEL: "error",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      if (s.includes("error") && process.env.EVAL_DEBUG) process.stderr.write(s);
    });
    try {
      await waitHealth(mcpBase);
    } catch (e) {
      child.kill();
      throw e;
    }
  }

  const rpc = makeRpc(mcpHttp);
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "eval-control-plane", version: "0.1.0" },
  });

  const addBroken = path.join(operator, "baselines", "lib", "add.js");
  const addFixed = path.join(operator, "patches", "add.fixed.js");
  const parserBaseline = path.join(operator, "baselines", "tests", "parser.test.js");
  const parserPath = path.join(fixture, "tests", "parser.test.js");

  resetFixtureNow();

  try {
    console.log("--- CASE 1: fail then known-good patch → verified ---");
    const start1 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    if (!start1?.jobId) {
      bad(`job_start: ${JSON.stringify(start1).slice(0, 200)}`);
    } else {
      const d1 = await runHost(start1.jobId, mcpHttp);
      if (d1?.status === "continue" && d1?.ruleId === "R5") ok("case1 initial continue");
      else bad(`case1 initial expected continue/R5 got ${JSON.stringify(d1)}`);

      copyFile(addFixed, path.join(fixture, "lib", "add.js"));
      const d2 = await runHost(start1.jobId, mcpHttp);
      if (d2?.status === "verified" && d2?.ruleId === "R6") ok("case1 verified after patch");
      else bad(`case1 expected verified/R6 got ${JSON.stringify(d2)}`);
    }

    copyFile(addBroken, path.join(fixture, "lib", "add.js"));

    console.log("--- CASE 2: same failing fingerprint ×3 → escalated ---");
    const start2 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    const failResults = [
      {
        checkId: "chk_test",
        status: "fail",
        exitCode: 1,
        fingerprint: "repeat-me",
        summary: "adds two numbers",
        logExcerpt: "not ok 1 - adds two numbers",
      },
      {
        checkId: "chk_test_inventory",
        status: "pass",
        exitCode: 0,
        fingerprint: "pass",
        summary: "ok",
        logExcerpt: "ok",
      },
    ];
    let last;
    for (let i = 0; i < 3; i++) {
      last = await rpc("tools/call", {
        name: "check_submit",
        arguments: {
          ...submitAuth(start2.jobId),
          results: failResults,
        },
      });
    }
    if (last?.status === "escalated" && last?.ruleId === "R3") ok("case2 escalated R3");
    else bad(`case2 expected escalated/R3 got ${JSON.stringify(last)}`);

    console.log("--- CASE 3: missing required check → rejected, job remains open ---");
    const start3 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    const missing = await rpc("tools/call", {
      name: "check_submit",
      arguments: { ...submitAuth(start3.jobId), results: [] },
    });
    if (missing?.error?.code === "check_required_missing") ok("case3 submit rejected");
    else bad(`case3 expected check_required_missing got ${JSON.stringify(missing)}`);
    const st3 = await rpc("tools/call", {
      name: "job_status",
      arguments: { jobId: start3.jobId },
    });
    if (st3?.state === "open") ok("case3 job still open");
    else bad(`case3 expected state open got ${JSON.stringify(st3)}`);

    console.log("--- CASE 4: delete parser.test.js → not verified ---");
    const start4 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-4", startToken },
    });
    if (start4?.error) {
      bad(`case4 job_start: ${JSON.stringify(start4).slice(0, 300)}`);
    } else {
      fs.unlinkSync(parserPath);
      try {
        const d4 = await runHost(start4.jobId, mcpHttp);
        if (d4?.status && d4.status !== "verified") {
          ok(`case4 not verified (${d4.status}/${d4.ruleId})`);
        } else {
          bad(`case4 expected not verified got ${JSON.stringify(d4)}`);
        }
      } finally {
        copyFile(parserBaseline, parserPath);
      }
    }

    console.log("--- CASE 5: gut parser.test.js (empty tests, file remains) → not verified ---");
    const start5 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-4", startToken },
    });
    if (start5?.error) {
      bad(`case5 job_start: ${JSON.stringify(start5).slice(0, 300)}`);
    } else {
      fs.writeFileSync(parserPath, "import { describe, it } from 'node:test';\n", "utf8");
      try {
        const d5 = await runHost(start5.jobId, mcpHttp);
        if (d5?.status && d5.status !== "verified") {
          ok(`case5 gutted tests not verified (${d5.status}/${d5.ruleId})`);
        } else {
          bad(`case5 expected not verified got ${JSON.stringify(d5)}`);
        }
      } finally {
        copyFile(parserBaseline, parserPath);
      }
    }

    console.log("--- CASE 6: forged pass without runnerToken is rejected ---");
    const start6 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    const forged = await rpc("tools/call", {
      name: "check_submit",
      arguments: {
        jobId: start6.jobId,
        results: [
          {
            checkId: "chk_test",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
          {
            checkId: "chk_test_inventory",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
        ],
      },
    });
    if (forged?.error?.code === "runner_required") ok("case6 forged submit rejected");
    else bad(`case6 expected runner_required got ${JSON.stringify(forged)}`);
    const st6 = await rpc("tools/call", {
      name: "job_status",
      arguments: { jobId: start6.jobId },
    });
    if (st6?.state === "open") ok("case6 job still open");
    else bad(`case6 expected open got ${JSON.stringify(st6)}`);

    console.log("--- CASE 7: job_start without startToken is rejected ---");
    const noStart = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1" },
    });
    if (noStart?.error?.code === "start_required") ok("case7 start rejected");
    else bad(`case7 expected start_required got ${JSON.stringify(noStart)}`);

    console.log("--- CASE 8: runnerToken without job nonce is rejected ---");
    const start8 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    const noNonce = await rpc("tools/call", {
      name: "check_submit",
      arguments: {
        jobId: start8.jobId,
        runnerToken,
        results: [
          {
            checkId: "chk_test",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
          {
            checkId: "chk_test_inventory",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
        ],
      },
    });
    if (noNonce?.error?.code === "runner_required") ok("case8 nonce required");
    else bad(`case8 expected runner_required got ${JSON.stringify(noNonce)}`);
    const st8 = await rpc("tools/call", {
      name: "job_status",
      arguments: { jobId: start8.jobId },
    });
    if (st8?.state === "open") ok("case8 job still open");
    else bad(`case8 expected open got ${JSON.stringify(st8)}`);

    console.log("--- CASE 9: published default token is rejected ---");
    const start9 = await rpc("tools/call", {
      name: "job_start",
      arguments: { taskId: "task-1", startToken },
    });
    const stolenDefault = await rpc("tools/call", {
      name: "check_submit",
      arguments: {
        jobId: start9.jobId,
        runnerToken: "ty_runner_local",
        runnerNonce: nonceFor(start9.jobId),
        results: [
          {
            checkId: "chk_test",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
          {
            checkId: "chk_test_inventory",
            status: "pass",
            exitCode: 0,
            fingerprint: "pass",
            summary: "forged",
            logExcerpt: "forged",
          },
        ],
      },
    });
    if (stolenDefault?.error?.code === "runner_required") ok("case9 default token rejected");
    else bad(`case9 expected runner_required got ${JSON.stringify(stolenDefault)}`);

    console.log("--- CASE 10: envelopes do not leak secrets ---");
    const leakedStart = leakKeys(start1);
    const leakedStatus = leakKeys(st8);
    if (!leakedStart.length && !leakedStatus.length) ok("case10 no secret keys in envelopes");
    else bad(`case10 leaked ${leakedStart.concat(leakedStatus).join(",")}`);
  } finally {
    resetFixtureNow();
    if (child) {
      child.kill();
      await sleep(300);
    }
  }

  if (failed) {
    console.error(`\n${failed} eval assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll control-plane eval cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
