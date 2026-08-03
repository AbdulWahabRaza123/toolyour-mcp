---
id: fix-verify-site-icons
title: Fix-Verify Site Icons
category: seo
description: Re-run site icons audit after favicon/icon fixes; pair with verify_task.
operationIds: siteIconsChecker
workflowId: site-icons-audit-job
---

# Fix-Verify Site Icons

## Preferred path

1. Baseline = prior `site-icons-audit` `jobReport`
2. `verify_task("fix verify site icons for https://…", { url }, baseline)`
3. Summarize reachability deltas and remaining prioritized actions only
