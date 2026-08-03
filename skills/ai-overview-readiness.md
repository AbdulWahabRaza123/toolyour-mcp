---
id: ai-overview-readiness
title: AI Overview Readiness
category: seo
description: Structural GEO / AI Overview extractability heuristics — not live AIO rank.
operationIds: aiOverviewReadinessChecker
workflowId: ai-overview-readiness-job
---

# AI Overview Readiness Skill

Use when the user wants a **structural GEO / AI Overview readiness** check.

## Preferred path

1. `plan_task("ai overview readiness for https://…")` — free estimate
2. `run_playbook("ai-overview-readiness", { url })` or `solve_task("ai overview readiness https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-ai-overview-readiness", { url })`

## Output

- Extractability / structure heuristics from `jobReport`
- Prioritized content/markup actions
- **Not** live AI Overview rank, presence, or citation status — never claim those
