---
id: fix-verify-seo-deploy-regression
title: Fix-Verify SEO Deploy Regression
category: seo
description: Re-run post-deploy SEO scorecard after fixes; pair with verify_task.
operationIds: bulkUrlSeoAuditor,seoChangeDiff
workflowId: seo-deploy-regression-job
---

# Fix-Verify SEO Deploy Regression

## Preferred path

1. Baseline = prior `seo-deploy-regression` `jobReport` (same URL list)
2. `verify_task("fix verify seo deploy regression …", { urls }, baseline)`
3. Summarize avg/worst score deltas and remaining prioritized actions only — no ranks or backlinks
