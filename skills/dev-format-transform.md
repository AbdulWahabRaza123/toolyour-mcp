---
id: dev-format-transform
title: Dev Format Transform
category: developer
description: Convert YAML/JSON/XML and format HTML/CSS/JS/SQL for agent pipelines.
operationIds: yamlToJson, jsonToYaml, jsonFormatter, xmlFormatter, htmlFormatter, cssFormatter, jsFormatter, sqlFormatter, sqlValidator
workflowId: dev-format-transform-job
---

# Dev Format Transform

Use for **format / convert** jobs on pasted source (YAML↔JSON, XML pretty-print, code formatters).

## Preferred path

1. `run_playbook("dev-format-transform", { text })`  
   - Workflow **`dev-format-transform-job`**: `yamlToJson` → `jsonFormatter` → `xmlFormatter` (continueOnError)
2. Single language format → `invoke_tool` (`htmlFormatter`, `cssFormatter`, `jsFormatter`, `sqlFormatter`)
3. SQL syntax heuristics only → `sqlValidator` (does **not** run against a database)
4. Minify → `cssMinifier` / `jsMinifier` via `invoke_tool`

## Output format

- Converted / formatted text (truncated if large)
- Validation notes for SQL
- Honest limits: not Prettier-as-a-service for every dialect; payload size caps apply
