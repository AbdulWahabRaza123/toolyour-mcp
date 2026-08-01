---
id: fix-verify-core-web-vitals
title: Fix-Verify Core Web Vitals
category: seo
description: Re-run CWV diagnosis after LCP/CLS/speed fixes; pair with verify_task.
operationIds: pageSpeedAnalyzer, seoAnalyze, socialMediaIntegration
workflowId: core-web-vitals-job
---

# Fix-Verify Core Web Vitals

## Preferred path

1. Baseline = prior `improve-core-web-vitals` / `page-performance` report
2. `verify_task("fix verify core web vitals for https://…", { url }, baseline)`
3. Highlight LCP/CLS/TTFB score deltas and remaining asset actions
