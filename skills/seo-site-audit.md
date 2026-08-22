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

## Host contract (any MCP agent)

1. `plan_task("seo audit https://…")` (free) — stop if `loop.initiate` is false  
2. `run_playbook("seo-site-audit", { url })` → `full-seo-audit`  
3. Apply **only** rank-1 `loop.nextActions` (`patchType` often `html`, `roleHint: edit`)  
4. `verify_task(goal, { url }, baseline)` until `loop.gate` is pass — or stop on `loop.stop`  
5. Do **not** `invoke_tool` for the same job  

## Related playbooks (same URL)

| Need | Skill |
|------|--------|
| Deeper 6-tool pass | `full-seo-optimization` |
| Lite technical gate | `technical-seo-audit` |
| Many URLs after deploy | `seo-deploy-regression` |
| Staging vs prod | `seo-staging-diff` |

## Local / unpublished pages

`run_playbook("content-ship", { html, enhance: false })` or `solve_task` with `input.html` — no public URL required.

Do not paste raw HTML into chat logs when avoidable — pass `input.html` on the tool call.

Golden path: `docs/TIER1-GOLDEN-PATH.md`
