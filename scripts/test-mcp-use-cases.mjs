#!/usr/bin/env node
/**
 * End-to-end MCP use-case tests — discovery → schema → invoke → workflows.
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
const client = new Client({ name: "use-cases", version: "1.0.0" });
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

const cases = [
  {
    name: "Discovery: text case converter",
    run: async () => {
      const r = await call("discover_tools", { query: "text case", limit: 1 });
      return r.data?.tools?.[0]?.operationId === "text_case_converter_post";
    },
    sample: async () => call("discover_tools", { query: "text case", limit: 1 }),
  },
  {
    name: "invoke_tool: text case converter (JSON)",
    run: async () => {
      const r = await call("invoke_tool", {
        operationId: "text_case_converter_post",
        input: { text: "hello world", case: "uppercase", mode: "single" },
      });
      return !r.isError && r.data?.status === 200;
    },
    sample: async () =>
      call("invoke_tool", {
        operationId: "text_case_converter_post",
        input: { text: "hello world", case: "uppercase", mode: "single" },
      }),
  },
  {
    name: "invoke_tool: slugify",
    run: async () => {
      const r = await call("invoke_tool", {
        operationId: "convert_to_slug_post",
        input: { text: "Hello World Example" },
      });
      return !r.isError && r.data?.status === 200;
    },
    sample: async () =>
      call("invoke_tool", {
        operationId: "convert_to_slug_post",
        input: { text: "Hello World Example" },
      }),
  },
  {
    name: "invoke_tool: SEO analyze",
    run: async () => {
      const r = await call("invoke_tool", {
        operationId: "seoAnalyze",
        input: { url: "https://example.com" },
      });
      return !r.isError && r.data?.status === 200;
    },
    sample: async () =>
      call("invoke_tool", {
        operationId: "seoAnalyze",
        input: { url: "https://example.com" },
      }),
  },
  {
    name: "invoke_tool: page speed (GET query)",
    run: async () => {
      const r = await call("invoke_tool", {
        operationId: "pageSpeedAnalyzer",
        input: { url: "https://example.com" },
      });
      return !r.isError && r.data?.status === 200;
    },
    sample: async () =>
      call("invoke_tool", {
        operationId: "pageSpeedAnalyzer",
        input: { url: "https://example.com" },
      }),
  },
  {
    name: "run_workflow: full-seo-audit",
    run: async () => {
      const r = await call("run_workflow", {
        workflowId: "full-seo-audit",
        input: { url: "https://example.com" },
      });
      return !r.isError && r.data?.status === "completed";
    },
    sample: async () =>
      call("run_workflow", {
        workflowId: "full-seo-audit",
        input: { url: "https://example.com" },
      }),
  },
  {
    name: "solve_task: SEO audit URL",
    run: async () => {
      const r = await call("solve_task", {
        goal: "full SEO audit for https://example.com",
        input: {},
      });
      return (
        !r.isError &&
        (r.data?.status === "completed" || r.data?.execution?.status === "completed")
      );
    },
    sample: async () =>
      call("solve_task", {
        goal: "full SEO audit for https://example.com",
        input: {},
      }),
  },
  {
    name: "solve_task: local HTML SEO (free)",
    run: async () => {
      const r = await call("solve_task", {
        goal: "local seo audit html",
        input: {
          html: "<html><head><title>Test Page</title><meta name=\"description\" content=\"Demo\"></head><body><h1>Hi</h1></body></html>",
          enhance: false,
        },
      });
      return !r.isError && r.data?.status === "completed";
    },
    sample: async () => null,
  },
  {
    name: "load_skill: seo-site-audit",
    run: async () => {
      const r = await call("load_skill", { skillId: "seo-site-audit" });
      return !r.isError && typeof r.data === "string" && r.data.includes("#");
    },
    sample: async () => call("load_skill", { skillId: "seo-site-audit" }),
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  process.stdout.write(`${c.name} ... `);
  try {
    const ok = await c.run();
    if (ok) {
      passed++;
      console.log("PASS");
      if (c.sample) {
        const sample = await c.sample();
        if (sample) {
          const out = JSON.stringify(sample.data, null, 2);
          console.log(out.slice(0, 900) + (out.length > 900 ? "\n…" : ""));
        }
      }
    } else {
      failed++;
      console.log("FAIL");
      const sample = c.sample ? await c.sample() : null;
      if (sample) console.log(JSON.stringify(sample, null, 2).slice(0, 1200));
    }
  } catch (e) {
    failed++;
    console.log("FAIL");
    console.error(String(e));
  }
  console.log("");
}

await transport.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
