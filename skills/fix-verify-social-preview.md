---
id: fix-verify-social-preview
title: Fix-Verify Social Preview
category: seo
description: Re-run Open Graph / Twitter Card audit after tag fixes; pair with verify_task.
operationIds: socialMediaIntegration
workflowId: social-preview-audit-job
---

# Fix-Verify Social Preview

## Preferred path

1. Baseline = prior social-preview `jobReport`
2. `verify_task("fix verify social preview for https://…", { url }, baseline)`
3. Confirm og:title / og:image / twitter card findings cleared; list remaining gaps
