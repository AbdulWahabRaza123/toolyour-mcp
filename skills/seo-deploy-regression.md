---
id: seo-deploy-regression
title: SEO Deploy Regression
category: seo
description: Post-deploy bulk URL scorecard and optional staging-vs-production SEO Change Diff.
operationIds: bulkUrlSeoAuditor, seoChangeDiff
workflowId: seo-deploy-regression-job
---

# SEO Deploy Regression Skill

Post-deploy bulk SEO scorecard (no live ranks or backlink data).

## Preferred path

1. `run_playbook("seo-deploy-regression", { urls: ["https://…", "…"] })` — free ≤5 URLs, paid ≤20
2. Read `jobReport.workstreams.bulk.worstUrls` and `prioritizedActions` first
3. **Staging vs production:** `run_playbook("seo-staging-diff", { urls, urlA, urlB })`
4. After template fixes: `verify_task` with baseline, or `run_playbook("fix-verify-seo-deploy-regression", …)`

Do not claim keyword ranks or AI Overview presence.
