---
id: fix-verify-indexability
title: Fix-Verify Indexability
category: seo
description: Re-run indexability audit after fixing noindex, canonical, or robots.txt blockers.
operationIds: indexabilityChecker, canonicalUrlChecker, robotsTxtChecker
workflowId: indexability-audit-job
---

# Fix-Verify Indexability Skill

1. Baseline = prior `indexability-audit` jobReport
2. `run_playbook("fix-verify-indexability", { url })` after fixes
3. Pair with `verify_task` until indexability blockers clear
