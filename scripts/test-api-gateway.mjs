#!/usr/bin/env node
/**
 * Direct API gateway tests (REST parity with MCP invoke_tool).
 */
const API_KEY = process.env.MCP_API_KEY || process.env.API_KEY;
const GATEWAY = (process.env.GATEWAY_URL || "http://127.0.0.1:8888").replace(/\/$/, "");
const SAAS_SECRET =
  process.env.SAAS_INTERNAL_SECRET ||
  "shared-secret-for-internal-endpoints-change-in-production";

if (!API_KEY) {
  console.error("Set MCP_API_KEY or API_KEY");
  process.exit(1);
}

const results = [];

async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail: msg });
    console.error(`✗ ${name} — ${msg}`);
  }
}

async function gatewayJson(path, opts = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...opts,
    headers: {
      "X-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok && res.status !== 422) {
    throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { status: res.status, data };
}

await test("Gateway health", async () => {
  const r = await fetch(`${GATEWAY}/health`);
  if (!r.ok) throw new Error(String(r.status));
  return "ok";
});

await test("SaaS validate-key (text-case-converter)", async () => {
  const r = await fetch(`${GATEWAY}/internal/validate-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SaaS-Secret": SAAS_SECRET,
    },
    body: JSON.stringify({
      apiKey: API_KEY,
      backend: "node",
      toolOrPath: "text-utilities/text-case-converter",
    }),
  });
  const data = await r.json();
  if (!data.allowed) throw new Error(data.reason || "denied");
  return `plan=${data.planName}`;
});

await test("API text-case-converter", async () => {
  const { status, data } = await gatewayJson(
    "/api/v1/text-utilities/text-case-converter",
    {
      method: "POST",
      body: JSON.stringify({ text: "hello api", case: "uppercase", mode: "single" }),
    }
  );
  const out = data?.result?.output?.result;
  if (status !== 200 || out !== "HELLO API") {
    throw new Error(JSON.stringify(data).slice(0, 200));
  }
  return out;
});

await test("API convert-to-slug", async () => {
  const { status, data } = await gatewayJson(
    "/api/v1/text-utilities/convert-to-slug",
    {
      method: "POST",
      body: JSON.stringify({ text: "Hello API World" }),
    }
  );
  const slug = data?.result?.output?.slug;
  if (status !== 200 || slug !== "hello-api-world") {
    throw new Error(JSON.stringify(data).slice(0, 200));
  }
  return slug;
});

await test("API seo-tools/analyze", async () => {
  const { status, data } = await gatewayJson("/api/v1/seo-tools/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://example.com" }),
  });
  if (status === 429) return "rate limited (ok infra)";
  const score = data?.result?.data?.overallScore;
  if (status !== 200 || score == null) {
    throw new Error(JSON.stringify(data).slice(0, 200));
  }
  return `score=${score}`;
});

await test("API page-speed-analyzer (GET)", async () => {
  const res = await fetch(
    `${GATEWAY}/api/v1/seo-apis/page-speed-analyzer?url=${encodeURIComponent("https://example.com")}`,
    { headers: { "X-Api-Key": API_KEY } }
  );
  const data = await res.json();
  if (res.status === 429) return "rate limited (ok infra)";
  const grade = data?.result?.report?.summary?.grade;
  if (res.status !== 200 || !grade) {
    throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return `grade=${grade}`;
});

await test("API health/node via gateway", async () => {
  const r = await fetch(`${GATEWAY}/health/node`);
  const data = await r.json();
  if (!r.ok || data.status !== "ok") throw new Error(JSON.stringify(data));
  return data.service;
});

await test("API health/python via gateway", async () => {
  const r = await fetch(`${GATEWAY}/health/python`);
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data.status;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nAPI tests: ${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
