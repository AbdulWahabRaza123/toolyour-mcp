---
id: full-seo-optimization
title: Full SEO Optimization
category: seo
description: Deep SEO job — on-page, content, speed, internal links, link extract, and social preview for one URL.
operationIds: seoAnalyze, contentOptimization, pageSpeedAnalyzer, internalLinking, linkExtractor, socialMediaIntegration
workflowId: full-seo-optimization-job
---

# Full SEO Optimization

Use when the user wants a **deep SEO pass** before launch or content refresh (heavier than `seo-site-audit` / `technical-seo-audit`).

## Preferred path

1. `plan_task("full seo optimization for https://…")` — note credit estimate
2. `run_playbook("full-seo-optimization", { url })` or `solve_task("full seo optimization https://…")`
3. After fixes: `verify_task` with baseline, or `run_playbook("fix-verify-seo-audit", { url })` for the lighter pair

## Output

- Merged workstreams (SEO, content, speed, links, social)
- Ranked actions by impact
- Remind: proxy speed metrics, not CrUX field CWV
