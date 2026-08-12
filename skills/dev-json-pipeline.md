---
id: dev-json-pipeline
title: Dev JSON Pipeline
category: developer
description: Validate and format JSON, then generate Zod or TypeScript types for agent codegen.
operationIds: jsonValidator, jsonFormatter, jsonToZod, jsonToTypescript, jsonToGoStruct, jsonToPython, yamlToJson, jsonToYaml
workflowId: dev-json-pipeline-job
---

# Dev JSON Pipeline

Use for **JSON → typed schema** jobs (validate, pretty-print, codegen). Deterministic ToolYour developer tools — not an LLM.

## Preferred path

1. Paste JSON (or YAML) → `run_playbook("dev-json-pipeline", { text })` or `{ json }`
   - Workflow **`dev-json-pipeline-job`**: `jsonValidator` → `jsonFormatter` → `jsonToZod`
2. TypeScript instead of Zod → `invoke_tool("jsonToTypescript", { … })`
3. Go / Python → `jsonToGoStruct` / `jsonToPython`
4. YAML in → `yamlToJson` then re-run pipeline; JSON out as YAML → `jsonToYaml`
5. Summarize from `jobReport` when present (validity, formatted preview, generated schema).

## Fallback

`discover_tools` → `get_tool_schema` → `invoke_tool` for a single transform.

## Output format

- Valid / invalid with parse errors
- Formatted JSON preview (truncated if huge)
- Generated schema / types for the next coding step
- Limits: oversized payloads may be rejected; not a live OpenAPI importer
