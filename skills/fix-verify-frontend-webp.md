---
id: fix-verify-frontend-webp
title: Fix-verify Frontend WebP
category: seo
description: Re-run WebP conversion after the host replaces img/srcset assets.
operationIds: pageSpeedAnalyzer, convertToWebp
workflowId: frontend-webp-job
---

# Fix-verify Frontend WebP

Re-score the same URL after WebP files are committed and deployed.

1. `run_playbook("fix-verify-frontend-webp", { url })` or `verify_task` with the prior baseline
2. Gate pass when `pendingImages` is empty / scores leave poor
3. Stop if `loop.initiate` is false
