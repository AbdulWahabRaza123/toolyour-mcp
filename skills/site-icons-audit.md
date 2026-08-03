---
id: site-icons-audit
title: Site Icons Audit
category: seo
description: Favicon, apple-touch, and common icon fallback reachability.
operationIds: siteIconsChecker
workflowId: site-icons-audit-job
---

# Site Icons Audit Skill

Use when the user wants to check **favicon / apple-touch / icon fallbacks**.

## Preferred path

1. `plan_task("site icons audit for https://…")` — free estimate
2. `run_playbook("site-icons-audit", { url })` or `solve_task("site icons https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-site-icons", { url })`

## Output

- Missing or unreachable icons first
- Prioritized actions from `jobReport`
