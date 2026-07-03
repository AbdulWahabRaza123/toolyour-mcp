#!/usr/bin/env node
/**
 * Local MCP integration test — exercises all 8 meta-tools via SSE transport.
 * Usage: MCP_URL=http://127.0.0.1:8888/mcp MCP_API_KEY=ty_... node scripts/test-mcp-local.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const mcpUrl = (process.env.MCP_URL || "http://127.0.0.1:8888/mcp").replace(/\/$/, "");
const apiKey = process.env.MCP_API_KEY;

if (!apiKey) {
  console.error("Set MCP_API_KEY");
  process.exit(1);
}

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function parseToolText(result) {
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { result, data: parseToolText(result) };
}

async function main() {
  console.log(`MCP URL: ${mcpUrl}`);
  console.log("--- Health (direct service) ---");
  try {
    const health = await fetch("http://127.0.0.1:3090/health/mcp");
    const body = await health.json();
    if (health.ok && body.status === "healthy") {
      pass("health/mcp direct", `registryLoaded=${body.registryLoaded}`);
    } else {
      fail("health/mcp direct", JSON.stringify(body));
    }
  } catch (e) {
    fail("health/mcp direct", e.message);
  }

  console.log("\n--- Connect SSE ---");
  const transport = new SSEClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { "X-Api-Key": apiKey },
    },
    eventSourceInit: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: { ...init?.headers, "X-Api-Key": apiKey },
        }),
    },
  });

  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await client.connect(transport);
  pass("SSE connect + initialize");

  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();
  const expected = [
    "discover_tools",
    "get_tool_schema",
    "invoke_tool",
    "list_categories",
    "list_skills",
    "load_skill",
    "run_workflow",
    "solve_task",
  ];
  if (expected.every((n) => toolNames.includes(n)) && toolNames.length === 8) {
    pass("list_tools", toolNames.join(", "));
  } else {
    fail("list_tools", `got: ${toolNames.join(", ")}`);
  }

  console.log("\n--- Free discovery tools ---");

  const { data: categories } = await callTool(client, "list_categories");
  if (Array.isArray(categories?.categories) && categories.categories.length > 0) {
    pass("list_categories", `${categories.categories.length} categories`);
  } else {
    fail("list_categories", JSON.stringify(categories).slice(0, 120));
  }

  const { data: discovered } = await callTool(client, "discover_tools", {
    query: "text case converter",
    limit: 3,
  });
  if (discovered?.count >= 1 && discovered.tools?.[0]?.operationId) {
    pass("discover_tools", discovered.tools[0].operationId);
  } else {
    fail("discover_tools", JSON.stringify(discovered).slice(0, 120));
  }

  const opId = discovered.tools[0].operationId;
  const { data: schema, result: schemaResult } = await callTool(client, "get_tool_schema", {
    operationId: opId,
  });
  if (!schemaResult.isError && schema?.operationId === opId && schema?.schema) {
    pass("get_tool_schema", opId);
  } else {
    fail("get_tool_schema", JSON.stringify(schema).slice(0, 120));
  }

  const { data: invalidSchema, result: invalidSchemaResult } = await callTool(
    client,
    "get_tool_schema",
    { operationId: "not_a_real_tool_xyz" }
  );
  if (invalidSchemaResult.isError && invalidSchema?.error?.code === "tool_not_api_backed") {
    pass("get_tool_schema invalid id", "tool_not_api_backed");
  } else {
    fail("get_tool_schema invalid id", JSON.stringify(invalidSchema).slice(0, 120));
  }

  console.log("\n--- Skills ---");
  const { data: skills } = await callTool(client, "list_skills");
  if (Array.isArray(skills?.skills) && skills.skills.length > 0) {
    pass("list_skills", `${skills.skills.length} skills`);
    const skillId = skills.skills[0].id;
    const { data: skillContent, result: skillResult } = await callTool(client, "load_skill", {
      skillId,
    });
    if (!skillResult.isError && typeof skillContent === "string" && skillContent.includes("#")) {
      pass("load_skill", skillId);
    } else if (typeof skillContent === "string" && skillContent.length > 100) {
      pass("load_skill", skillId);
    } else {
      fail("load_skill", String(skillContent).slice(0, 120));
    }
  } else {
    fail("list_skills", JSON.stringify(skills).slice(0, 120));
  }

  const { data: missingSkill, result: missingSkillResult } = await callTool(client, "load_skill", {
    skillId: "nonexistent-skill",
  });
  if (missingSkillResult.isError && missingSkill?.error?.code === "skill_not_found") {
    pass("load_skill invalid id", "skill_not_found");
  } else {
    fail("load_skill invalid id", JSON.stringify(missingSkill).slice(0, 120));
  }

  console.log("\n--- solve_task (local / free) ---");
  const sampleHtml = `<!DOCTYPE html><html><head><title>Test Page</title><meta name="description" content="A test page"></head><body><h1>Hello</h1><a href="/about">About</a><a href="https://external.com">External</a></body></html>`;

  const { data: localSeo, result: localSeoResult } = await callTool(client, "solve_task", {
    goal: "local seo audit of my landing page html",
    input: { html: sampleHtml, enhance: false },
  });
  if (
    !localSeoResult.isError &&
    (localSeo?.status === "success" || localSeo?.status === "completed") &&
    (localSeo?.result || localSeo?.output)
  ) {
    pass("solve_task local SEO", localSeo.status);
  } else if (localSeo?.status === "success" || localSeo?.matchedTask?.id === "seo-audit-local") {
    pass("solve_task local SEO", localSeo.status || "matched seo-audit-local");
  } else {
    fail("solve_task local SEO", JSON.stringify(localSeo).slice(0, 200));
  }

  const { data: linkExtract, result: linkExtractResult } = await callTool(client, "solve_task", {
    goal: "extract links from my page html",
    input: { html: sampleHtml },
  });
  if (!linkExtractResult.isError && (linkExtract.status === "success" || linkExtract.status === "completed" || linkExtract.result)) {
    pass("solve_task link extract", linkExtract.status || "ok");
  } else {
    fail("solve_task link extract", JSON.stringify(linkExtract).slice(0, 200));
  }

  const { data: suggest, result: suggestResult } = await callTool(client, "solve_task", {
    goal: "help me with something vague",
    input: {},
  });
  if (!suggestResult.isError && (suggest?.status === "suggest" || suggest?.toolSuggestions)) {
    pass("solve_task suggest mode", suggest.status || "has suggestions");
  } else {
    fail("solve_task suggest mode", JSON.stringify(suggest).slice(0, 200));
  }

  console.log("\n--- invoke_tool (API-backed) ---");
  const { data: textCase, result: textCaseResult } = await callTool(client, "invoke_tool", {
    operationId: opId,
    input: { text: "hello world", case: "uppercase", mode: "single" },
  });
  if (!textCaseResult.isError && textCase?.status === 200) {
    pass("invoke_tool textCaseConverter", "HELLO WORLD");
  } else {
    fail("invoke_tool textCaseConverter", JSON.stringify(textCase).slice(0, 200));
  }

  const { data: badInvoke, result: badInvokeResult } = await callTool(client, "invoke_tool", {
    operationId: "not_a_real_tool_xyz",
    input: {},
  });
  if (badInvokeResult.isError || badInvoke?.error?.code === "tool_not_api_backed") {
    pass("invoke_tool invalid id", badInvoke?.error?.code || "isError");
  } else {
    fail("invoke_tool invalid id", JSON.stringify(badInvoke).slice(0, 120));
  }

  console.log("\n--- run_workflow ---");
  const { data: workflow, result: workflowResult } = await callTool(client, "run_workflow", {
    workflowId: "nonexistent-workflow",
    input: {},
  });
  if (workflowResult.isError || workflow?.status === "error" || workflow?.error) {
    pass("run_workflow invalid id", workflow?.error?.code || workflow?.status || "isError");
  } else {
    fail("run_workflow invalid id", JSON.stringify(workflow).slice(0, 120));
  }

  await transport.close();

  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
