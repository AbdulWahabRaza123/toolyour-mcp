---
id: content-quality
title: Content Quality
category: content
description: Audit content structure, readability, and keyword signals for a URL.
operationIds: contentOptimization, rankCheckerKeywords
workflowId: content-quality-audit-job
---

# Content Quality Skill

Audit content depth, headings, readability, and keyword signals.

## Preferred path

1. **Live URL:** `run_playbook("content-quality", { url: "https://…" })`
2. **Unpublished HTML:** `run_playbook("content-ship", { html: "…", enhance: false })`
3. Read `jobReport.workstreams.contentQuality` and `keywordSignals`
4. After fixes: `verify_task` with baseline

Do not paste full page HTML into chat — summarize `jobReport` only.
