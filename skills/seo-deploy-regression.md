---
id: seo-deploy-regression
title: SEO Deploy Regression
category: seo
description: Post-deploy bulk URL scorecard and optional staging-vs-production SEO Change Diff.
operationIds: bulkUrlSeoAuditor, seoChangeDiff
---

# SEO Deploy Regression Skill

Use this playbook when the user wants to **check SEO after a deploy** (no live ranks; no paid SERP/backlink data).

## Steps

1. Prefer `solve_task` with goals like:
   - *"seo regression after deploy"* / *"post deploy seo"* → workflow `seo-deploy-regression-job` with `input.urls` (array; free ≤5, paid ≤20).
   - *"staging vs production"* template check → `seo-deploy-regression-diff-job` with `input.urls` **and** `input.urlA` + `input.urlB` (e.g. staging vs live homepage).
2. Read `jobReport.workstreams.bulk.worstUrls` and `prioritizedActions` first.
3. For weak template pages, run SEO Change Diff (or the diff job) between staging and production, then summarize field regressions.
4. After fixes, re-run the bulk job on the same URL list.
5. Do not claim keyword ranks, backlinks, or AI Overview presence.
6. Do not paste raw HTML — summarize `jobReport` for the user.

## Output format

- Deploy health summary (avg / worst scores)
- Top worst URLs
- Template diff regressions (if run)
- Next actions (fix → re-bulk)
