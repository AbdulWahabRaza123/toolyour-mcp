---
id: document-pipeline
title: Document Pipeline
category: documents
description: Convert documents and deliver download URLs for agent-safe file handoff.
operationIds: docx_to_pdf
---

# Document Pipeline Skill

For **document conversion** workflows:

1. `discover_tools("docx pdf")` to confirm operationIds.
2. `invoke_tool` with file fields per `get_tool_schema`.
3. Responses return `downloadUrl` — pass the URL to the user, not file bytes.
4. For multi-step convert + extract, use `run_workflow` `document-convert-pipeline`.
