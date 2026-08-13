---
id: seo-site-audit
title: SEO Site Audit
category: seo
description: Crawl a URL and run on-page SEO checks using API-backed ToolYour tools.
operationIds: seoAnalyze, pageSpeedAnalyzer, bulkUrlSeoAuditor
workflowId: full-seo-audit
---

# SEO Site Audit Skill

Full page SEO + page speed audit for a **public URL**.

**Payload first:** if they have page HTML in the repo (not a live link), use `run_playbook("content-ship", { html })` or `solve_task` with `input.html` (`seo-audit-local`) — free unless `enhance:true`. Do not ask for a URL unless they asked to crawl a live site.

## Preferred path

1. `plan_task("seo audit https://example.com")` (free)
2. `run_playbook("seo-site-audit", { url: "https://…" })` → `full-seo-audit`
3. Read `jobReport.prioritizedActions` and workstreams — summarize for the user
4. After fixes: `verify_task(goal, { url }, baselineJobReport)`

## Related playbooks (same URL)

| Need | Skill |
|------|--------|
| Deeper 6-tool pass | `full-seo-optimization` |
| Lite technical gate | `technical-seo-audit` |
| Many URLs after deploy | `seo-deploy-regression` |
| Staging vs prod | `seo-staging-diff` |

## Local / unpublished pages

`run_playbook("content-ship", { html, enhance: false })` or `solve_task` with `input.html` — no public URL required.

Do not paste raw HTML — use compact MCP responses only.
