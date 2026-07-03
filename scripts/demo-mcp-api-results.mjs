#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const apiKey = process.env.MCP_API_KEY;
const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:8888/mcp";
if (!apiKey) process.exit(1);

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
const client = new Client({ name: "demo", version: "1.0.0" });
await client.connect(transport);

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  return { isError: r.isError, data: JSON.parse(text) };
}

const tests = [
  ["invoke_tool seoAnalyze", "invoke_tool", { operationId: "seoAnalyze", input: { url: "https://example.com" } }],
  ["invoke_tool text_case_converter", "invoke_tool", { operationId: "text_case_converter_post", input: { text: "hello world", case: "uppercase", mode: "single" } }],
  ["solve_task seo audit", "solve_task", { goal: "SEO audit for https://example.com", input: {} }],
  ["list_categories", "list_categories", {}],
  ["solve_task local seo", "solve_task", { goal: "local seo audit", input: { html: "<html><head><title>Test</title></head><body><h1>Hi</h1></body></html>", enhance: false } }],
];

for (const [label, tool, args] of tests) {
  console.log(`\n### ${label}\n`);
  const r = await call(tool, args);
  console.log(JSON.stringify(r, null, 2).slice(0, 2500));
  if (JSON.stringify(r).length > 2500) console.log("…(truncated)");
}

await transport.close();
