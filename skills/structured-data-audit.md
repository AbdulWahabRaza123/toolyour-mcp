---
id: structured-data-audit
title: Structured Data Audit
category: seo
description: Schema markup, meta tags, and social preview tags for a URL.
operationIds: schemaMarkupValidator,metaTagsAnalyzer,socialMediaIntegration
workflowId: structured-data-audit-job
---

# Structured Data Audit Skill

Use when the user wants to audit **schema, meta, and social tags** on a page.

## Preferred path

1. `plan_task("structured data audit for https://…")` — free estimate
2. `run_playbook("structured-data-audit", { url })` or `solve_task("structured data audit https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-structured-data", { url })`

## Output

- Schema / meta / social findings from `jobReport`
- Prioritized fix actions
- Do not claim rich-result eligibility or live SERP appearance
