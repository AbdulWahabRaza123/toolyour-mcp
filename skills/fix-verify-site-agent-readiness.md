---
id: fix-verify-site-agent-readiness
title: Fix-Verify Site Agent Readiness
category: seo
description: Re-run GEO + AI SEO site audit after fixes; not live AI rank.
operationIds: geoSeoAuditor,aiSeoChecker,aiOverviewReadinessChecker
workflowId: site-agent-readiness-job
---

# Fix-Verify Site Agent Readiness

## Preferred path

1. Baseline = prior `site-agent-readiness` `jobReport`
2. `verify_task("fix verify site agent readiness for https://…", { url }, baseline)`
3. Summarize GEO origin + site sample deltas — never claim live AI rank or citations
