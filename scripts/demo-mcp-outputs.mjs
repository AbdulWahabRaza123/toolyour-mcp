#!/usr/bin/env node
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

const client = new Client({ name: "demo", version: "1.0.0" });
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

const sampleHtml = `<!DOCTYPE html><html><head><title>ToolYour Landing</title><meta name="description" content="Free online tools for developers"><meta name="robots" content="noindex"></head><body><h1>Welcome</h1><p>Build faster with ToolYour.</p><a href="/docs">Docs</a><a href="https://github.com/toolyour">GitHub</a></body></html>`;

const sections = [
  ["list_categories", {}],
  ["discover_tools", { query: "page speed", limit: 2 }],
  ["get_tool_schema", { operationId: "page_speed_analyzer_post" }],
  ["list_skills", {}],
  ["load_skill", { skillId: "seo-site-audit" }],
  [
    "solve_task",
    {
      goal: "local seo audit of my landing page",
      input: { html: sampleHtml, enhance: false },
    },
  ],
  [
    "solve_task",
    { goal: "extract links from html", input: { html: sampleHtml } },
  ],
  ["solve_task", { goal: "something helpful", input: {} }],
  [
    "invoke_tool",
    {
      operationId: "text_case_converter_post",
      input: { text: "hello world", caseType: "upper" },
    },
  ],
  ["get_tool_schema", { operationId: "fake_tool_xyz" }],
];

for (const [name, args] of sections) {
  const label = args.goal ? `${name} (${args.goal.slice(0, 40)}...)` : name;
  console.log(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}`);
  const result = await call(name, args);
  console.log(JSON.stringify(result, null, 2));
}

await transport.close();
