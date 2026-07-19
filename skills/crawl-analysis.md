---
id: crawl-analysis
title: Crawl Analysis
category: seo
description: Crawl URLs and produce a compact analysis for LLM consumption.
operationIds: linkExtractor, internalLinking, seoAnalyze
---

# Crawl Analysis Skill

For **crawl-only** or **site structure** analysis:

1. Prefer `solve_task` with goals like *"find orphan pages on {url}"* or *"improve internal linking {url}"* → workflow `internal-link-architecture-job`.
2. Read `jobReport.scores` for `orphanPages`, `brokenLinks`, and `hubPages` counts/status; fix **broken links first** (`prioritizedActions` ranks them #1).
3. Read `jobReport.workstreams.linkGraph` for orphans, broken links, hub pages, and suggested links.
4. Invoke crawl API tools with the seed URL when you need a single tool only.
5. Use summarized JSON from MCP — never request full HTML in context.
6. Report: status codes, depth, broken links, orphan pages, hub candidates, and prioritized link actions.
