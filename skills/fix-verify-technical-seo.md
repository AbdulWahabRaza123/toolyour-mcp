---
id: fix-verify-technical-seo
title: Fix-Verify Technical SEO
category: seo
description: Re-run technical SEO audit after on-page/link/speed fixes; pair with verify_task.
operationIds: seoAnalyze,linkExtractor,pageSpeedAnalyzer
workflowId: technical-seo-audit-job
---

# Fix-Verify Technical SEO

## Preferred path

1. Baseline = prior `technical-seo-audit` `jobReport`
2. `verify_task("fix verify technical seo for https://…", { url }, baseline)`
3. Summarize score deltas and remaining prioritized actions only
