---
id: dev-format-transform
title: Dev Format Transform
category: developer
description: YAML→JSON→pretty JSON→XML format playbook; one-shot HTML/CSS/JS/SQL/minify/cron/color via plan_task or invoke_tool.
operationIds: yamlToJson, jsonToYaml, jsonFormatter, xmlFormatter, htmlFormatter, cssFormatter, jsFormatter, sqlFormatter, sqlValidator, cssMinifier, jsMinifier, regexGenerator, cronExpressionGenerator, cronExpressionParser, colorConverter
workflowId: dev-format-transform-job
---

# Dev Format Transform

Use for **multi-step format / convert** jobs on pasted source. Single-language format, minify, cron, and color jobs are **one-shots** — prefer `plan_task` / `invoke_tool`, not this playbook.

## Preferred path

1. YAML / JSON / XML pipeline → `run_playbook("dev-format-transform", { text })`  
   - Workflow **`dev-format-transform-job`**: `yamlToJson` → `jsonFormatter` → `xmlFormatter` (continueOnError)
2. One language only → `plan_task` then `invoke_tool`  
   - Format: `htmlFormatter`, `cssFormatter`, `jsFormatter`, `sqlFormatter`  
   - SQL structure check (no DB): `sqlValidator`  
   - Minify (lite, not Terser/cssnano): `cssMinifier`, `jsMinifier`  
   - Cron build / parse (UTC next runs): `cronExpressionGenerator`, `cronExpressionParser`  
   - Color hex/rgb/hsl: `colorConverter`  
   - Regex presets (not AI-written): `regexGenerator`
3. Multi HTML+CSS in one goal → still this playbook only when the agent needs the YAML/JSON/XML chain; otherwise call formatters separately

## Output format

- Converted / formatted text (truncated if large)
- Validation notes for SQL when using `sqlValidator`
- Honest limits: playbook steps are YAML→JSON→XML only; Prettier-backed HTML/CSS/JS and heuristic SQL are separate one-shots; payload size caps apply
