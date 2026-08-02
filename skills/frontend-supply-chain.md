---
id: frontend-supply-chain
title: Frontend Supply Chain
category: security
description: Check SRI, mixed content, and CORS for a public URL; paste CSP text into cspPolicyEvaluator separately.
operationIds: subresourceIntegrityChecker, mixedContentChecker, corsPolicyChecker, cspPolicyEvaluator
workflowId: frontend-supply-chain-job
---

# Frontend Supply Chain Skill

Use when the user cares about **script/style integrity**, **HTTPS asset loading**, or **CORS** on a public page.

## Preferred path

1. `run_playbook("frontend-supply-chain", { url })` → **`frontend-supply-chain-job`**
   - Steps: SRI → mixed content → CORS
2. Paste a Content-Security-Policy string → `invoke_tool("cspPolicyEvaluator", { policy })`
3. Broader site harden → `web-security-audit` / `ship-gate`
4. After fixes → `verify_task` or `fix-verify-frontend-supply-chain`

## Output format

- Integrity gaps (missing integrity attrs)
- Mixed http:// assets
- CORS risk summary
- CSP authoring next step if policy text is available
