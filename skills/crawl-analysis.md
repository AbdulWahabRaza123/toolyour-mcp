---
id: crawl-analysis
title: Crawl Analysis
category: seo
description: Crawl URLs and produce a compact analysis for LLM consumption.
operationIds: linkExtractor, seoAnalyze
---

# Crawl Analysis Skill

For **crawl-only** or **site structure** analysis:

1. Invoke crawl API tools with the seed URL.
2. Use summarized JSON from MCP — never request full HTML in context.
3. Report: status codes, depth, broken links (if provided), next steps.
