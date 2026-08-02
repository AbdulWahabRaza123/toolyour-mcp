---
id: fix-verify-frontend-supply-chain
title: Fix-Verify Frontend Supply Chain
category: security
description: Re-run SRI / mixed content / CORS after fixes; pair with verify_task.
operationIds: subresourceIntegrityChecker, mixedContentChecker, corsPolicyChecker
workflowId: frontend-supply-chain-job
---

# Fix-Verify Frontend Supply Chain

## Preferred path

1. Baseline = prior `jobReport` from `frontend-supply-chain` / `web-security-audit`
2. `verify_task("fix verify frontend supply chain for https://…", { url }, baseline)`
3. Or `run_playbook("fix-verify-frontend-supply-chain", { url })` then compare with `verify_task`
4. Summarize score delta + resolved vs new findings only
