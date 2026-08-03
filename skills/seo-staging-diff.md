---
id: seo-staging-diff
title: SEO Staging Diff
category: seo
description: Post-deploy bulk URL scorecard plus staging-vs-production SEO Change Diff in one playbook.
operationIds: bulkUrlSeoAuditor, seoChangeDiff
workflowId: seo-deploy-regression-diff-job
---

# SEO Staging Diff

Use when comparing **staging vs production** templates after a deploy.

## Preferred path

1. `run_playbook("seo-staging-diff", { urls: [...], urlA: "https://staging…", urlB: "https://www…" })`
2. Or `solve_task("staging vs production seo diff")` with the same input
3. Read `jobReport` worst URLs + diff regressions first
4. After template fixes, re-run bulk (`seo-deploy-regression`) then this diff again

## Input

- `urls` — batch for bulk scorecard (plan caps apply)
- `urlA` / `urlB` — pair for SEO Change Diff (e.g. staging homepage vs live)

## Output

- Deploy health + worst URLs
- Field-level template regressions
- Do not claim keyword ranks or backlinks
