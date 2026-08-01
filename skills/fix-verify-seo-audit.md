---
id: fix-verify-seo-audit
title: Fix-Verify SEO Audit
category: seo
description: Re-run full SEO + page speed audit after fixes; pair with verify_task.
operationIds: seoAnalyze, pageSpeedAnalyzer
workflowId: full-seo-audit
---

# Fix-Verify SEO Audit

## Preferred path

1. Baseline = prior `seo-audit` / `seo-site-audit` `jobReport`
2. `verify_task("fix verify seo audit for https://…", { url }, baseline)`
3. Summarize score deltas and remaining prioritized actions only
