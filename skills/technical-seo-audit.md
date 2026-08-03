---
id: technical-seo-audit
title: Technical SEO Audit
category: seo
description: Mid-sprint technical SEO gate — on-page SEO, link extract, and page speed for one URL.
operationIds: seoAnalyze, linkExtractor, pageSpeedAnalyzer
workflowId: technical-seo-audit-job
---

# Technical SEO Audit

Use when the user wants a **lighter technical SEO check** than full optimization (faster credit use mid-sprint).

## Preferred path

1. `plan_task("technical seo audit for https://…")`
2. `run_playbook("technical-seo-audit", { url })` or `solve_task("technical seo https://…")`
3. After fixes: `verify_task` with baseline, or escalate to `full-seo-optimization` / `seo-site-audit`

## Output

- Merged SEO + links + speed findings
- Prioritized actions
- For content+social+links depth, use `full-seo-optimization`
