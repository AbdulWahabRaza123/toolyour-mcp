---
id: paid-ads-copy-gate
title: Paid Ads Copy Gate
category: marketing
description: Ads copy limits and Google RSA preview.
operationIds: adsCopyCounter, googleAdsRsaPreview
workflowId: paid-ads-copy-gate-job
---

# Paid Ads Copy Gate

1. `plan_task`
2. `run_playbook("paid-ads-copy-gate", { platform, headlines, ... })`
3. After fixes: `run_playbook("fix-verify-paid-ads-copy-gate", { ... })` or `verify_task`
