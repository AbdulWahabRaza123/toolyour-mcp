---
id: fix-verify-campaign-tracking-setup
title: Fix-Verify Campaign Tracking Setup
category: marketing
description: Re-run campaign tracking after fixes; pair with verify_task.
operationIds: utmBuilder, adsUtmBuilder, utmParser
workflowId: campaign-tracking-setup-job
---

# Fix-Verify Campaign Tracking Setup

1. Baseline = prior `campaign-tracking-setup` `jobReport`
2. `run_playbook("fix-verify-campaign-tracking-setup", { ... })` or `verify_task` with baseline
