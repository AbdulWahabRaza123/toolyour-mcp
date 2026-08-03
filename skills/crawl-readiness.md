---
id: crawl-readiness
title: Crawl Readiness
category: seo
description: robots.txt, sitemap XML, and redirect-chain hygiene for launch/index readiness.
operationIds: robotsTxtChecker,sitemapXmlValidator,redirectChainAnalyzer
workflowId: crawl-readiness-job
---

# Crawl Readiness Skill

Use when the user wants to check **crawl/index readiness** (robots, sitemap, redirects).

## Preferred path

1. `plan_task("crawl readiness for https://…")` — free estimate
2. `run_playbook("crawl-readiness", { url })` or `solve_task("crawl readiness https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-crawl-readiness", { url })`

## Output

- Blockers first (robots disallow, broken sitemap, redirect loops)
- Prioritized actions from `jobReport`
- Do not claim indexing or ranking outcomes
