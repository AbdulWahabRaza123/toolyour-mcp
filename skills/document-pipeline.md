---
id: document-pipeline
title: Document Pipeline
category: documents
description: Convert documents and deliver download URLs for agent-safe file handoff.
operationIds: docx_to_pdf
workflowId: document-convert-pipeline
---

# Document Pipeline Skill

Convert Office documents in one MCP call.

## Preferred path

1. `plan_task("convert docx to pdf")` (free estimate)
2. `run_playbook("document-pipeline", { file: … })` per `get_tool_schema("docx_to_pdf")`
3. Read `downloadUrl` from the job result — pass the URL to the user, not raw bytes

Do not chain `discover_tools` → `invoke_tool` when this playbook is mapped.
