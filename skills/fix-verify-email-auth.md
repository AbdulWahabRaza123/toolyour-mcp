---
id: fix-verify-email-auth
title: Fix-Verify Email Auth
category: security
description: Re-run SPF/DKIM/DMARC + DNS after email/DNS fixes; pair with verify_task.
operationIds: spfDkimDmarcChecker, dnsLookup, securityTxtChecker
workflowId: email-auth-security-job
---

# Fix-Verify Email Auth

## Preferred path

1. Baseline = prior `email-auth-security` / `dns-email-security` report
2. `verify_task("fix verify email auth for https://…", { url }, baseline)`
3. Confirm SPF/DKIM/DMARC findings cleared; list remaining DNS gaps
