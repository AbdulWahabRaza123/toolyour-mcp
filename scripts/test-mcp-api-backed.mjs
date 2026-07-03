#!/usr/bin/env node
/**
 * API-backed MCP tests after hasApi enablement.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const apiKey = process.env.MCP_API_KEY;
const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:8888/mcp";
if (!apiKey) {
  console.error("Set MCP_API_KEY");
  process.exit(1);
}

const transport = new SSEClientTransport(new URL(mcpUrl), {
  requestInit: { headers: { "X-Api-Key": apiKey } },
  eventSourceInit: {
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        headers: { ...init?.headers, "X-Api-Key": apiKey },
      }),
  },
});

const client = new Client({ name: "api-test", version: "1.0.0" });
await client.connect(transport);

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return { isError: r.isError, data: JSON.parse(text) };
  } catch {
    return { isError: r.isError, data: text };
  }
}

const tests = [
  {
    label: "invoke_tool — text_case_converter_post",
    fn: () =>
      call("invoke_tool", {
        operationId: "text_case_converter_post",
        input: { text: "hello world", caseType: "upper" },
      }),
  },
  {
    label: "invoke_tool — slugify_post",
    fn: () =>
      call("invoke_tool", {
        operationId: "slugify_post",
        input: { text: "Hello World Example" },
      }),
  },
  {
    label: "invoke_tool — pageSpeedAnalyzer",
    fn: () =>
      call("invoke_tool", {
        operationId: "pageSpeedAnalyzer",
        input: { url: "https://example.com" },
      }),
  },
  {
    label: "solve_task — SEO analyze URL",
    fn: () =>
      call("solve_task", {
        goal: "analyze seo for https://example.com",
        input: {},
      }),
  },
  {
    label: "run_workflow — full-seo-audit",
    fn: () =>
      call("run_workflow", {
        workflowId: "full-seo-audit",
        input: { url: "https://example.com" },
      }),
  },
];

const results = [];
for (const t of tests) {
  console.log(`\n${"=".repeat(60)}\n${t.label}\n${"=".repeat(60)}`);
  try {
    const result = await t.fn();
    console.log(JSON.stringify(result, null, 2));
    const ok =
      !result.isError &&
      !result.data?.error &&
      (result.data?.status === "completed" ||
        result.data?.status === "success" ||
        result.data?.result ||
        result.data?.output ||
        result.data?.data ||
        result.data?.downloadUrl ||
        (typeof result.data === "object" && Object.keys(result.data).length > 0));
    results.push({ label: t.label, ok, result });
  } catch (e) {
    console.error(String(e));
    results.push({ label: t.label, ok: false, error: String(e) });
  }
}

await transport.close();

console.log(`\n${"=".repeat(60)}\nSUMMARY\n${"=".repeat(60)}`);
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.label}`);
}
const failed = results.filter((r) => !r.ok).length;
process.exit(failed > 0 ? 1 : 0);
