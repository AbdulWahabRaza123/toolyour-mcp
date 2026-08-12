---
id: content-refresh
title: Content Refresh
category: content
description: Audit outdated content and suggest refresh using AI + SEO tools.
operationIds: aiTextAi, contentOptimization
workflowId: content-quality-audit-job
---

# Content Refresh Skill

Refresh blog or landing copy with a structured audit first.

## Preferred path

1. **Live URL:** `run_playbook("content-refresh", { url: "https://…" })` → `content-quality-audit-job`
2. For deeper SEO + links + speed on the same URL, use `run_playbook("full-seo-optimization", { url })` instead
3. Read `jobReport.workstreams.contentQuality` and keyword signals
4. After edits: `verify_task(goal, { url }, baselineJobReport)`

Do not manually chain discover_tools unless the playbook returns `need_workflow`.
