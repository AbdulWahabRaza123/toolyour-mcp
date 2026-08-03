---
id: fix-verify-structured-data
title: Fix-Verify Structured Data
category: seo
description: Re-run schema/meta/social audit after fixes; pair with verify_task.
operationIds: schemaMarkupValidator,metaTagsAnalyzer,socialMediaIntegration
workflowId: structured-data-audit-job
---

# Fix-Verify Structured Data

## Preferred path

1. Baseline = prior `structured-data-audit` `jobReport`
2. `verify_task("fix verify structured data for https://…", { url }, baseline)`
3. Summarize score deltas and remaining prioritized actions only
