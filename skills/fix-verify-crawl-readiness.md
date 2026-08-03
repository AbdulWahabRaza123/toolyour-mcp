---
id: fix-verify-crawl-readiness
title: Fix-Verify Crawl Readiness
category: seo
description: Re-run crawl readiness after robots/sitemap/redirect fixes; pair with verify_task.
operationIds: robotsTxtChecker,sitemapXmlValidator,redirectChainAnalyzer
workflowId: crawl-readiness-job
---

# Fix-Verify Crawl Readiness

## Preferred path

1. Baseline = prior `crawl-readiness` `jobReport`
2. `verify_task("fix verify crawl readiness for https://…", { url }, baseline)`
3. Summarize score deltas and remaining prioritized actions only
