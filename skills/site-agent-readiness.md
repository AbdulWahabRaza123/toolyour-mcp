---
id: site-agent-readiness
title: Site Agent Readiness
category: seo
description: GEO origin audit, site-wide AI SEO sample, and homepage structural readiness for AI crawlers.
operationIds: geoSeoAuditor,aiSeoChecker,aiOverviewReadinessChecker
workflowId: site-agent-readiness-job
---

# Site Agent Readiness Skill

Use when the user wants **full-site AI / GEO readiness** — not just one page or crawl files alone.

## Preferred path

1. `plan_task("site agent readiness for https://…")` — free estimate
2. `run_playbook("site-agent-readiness", { url })` or `solve_task("geo seo audit https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-site-agent-readiness", { url })`

## What runs

| Step | Tool | Focus |
|------|------|--------|
| GEO SEO auditor | `geoSeoAuditor` | llms.txt, AI bot robots, sitemap, discovery probes |
| AI SEO checker | `aiSeoChecker` | Sitemap sample — answer blocks, schema coverage |
| Homepage AIO | `aiOverviewReadinessChecker` | Deep structural pass on homepage (optional continue) |

## Output

- Origin blockers first (missing llms.txt, AI bots blocked, empty sitemap)
- Site sample heatmap findings from AI SEO checker
- Prioritized actions from `jobReport`
- Do **not** claim live ChatGPT or AI Overview rank
