---
id: crawl-analysis
title: Crawl Analysis
category: seo
description: Crawl URLs and produce a compact analysis for LLM consumption.
operationIds: linkExtractor, internalLinking, seoAnalyze
workflowId: internal-link-architecture-job
---

# Crawl Analysis Skill

Site structure, internal links, orphans, and broken destinations for one seed URL.

## Preferred path

1. `run_playbook("crawl-analysis", { url: "https://…" })` → `internal-link-architecture-job`
2. Read `jobReport.workstreams.linkGraph` — fix **broken links first**
3. Read orphan pages and hub candidates from `jobReport.scores`
4. After fixes: `verify_task` with baseline

Prefer this playbook over manual `discover_tools` → `invoke_tool` chains.
