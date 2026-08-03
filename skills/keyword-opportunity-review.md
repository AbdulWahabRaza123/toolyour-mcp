---
id: keyword-opportunity-review
title: Keyword Opportunity Review
category: seo
description: Review keyword density and content optimization signals for a URL or pasted draft.
operationIds: rankCheckerKeywords, contentOptimization
workflowId: keyword-opportunity-review-job
---

# Keyword Opportunity Review

Use when the user wants **keyword / content opportunity** signals (not live SERP ranks).

## Preferred path

1. `plan_task("keyword opportunity for https://…")` — free estimate
2. `run_playbook("keyword-opportunity-review", { url })` or `solve_task("keyword opportunity review https://…")`
3. For pasted drafts without a URL, prefer browser keyword tools or pass `text` when the workflow accepts it
4. After edits: `verify_task` with the prior `jobReport` as `baseline`

## Output

- Keyword / content scores and findings
- Prioritized wording actions
- Do not claim live rankings or backlink data
