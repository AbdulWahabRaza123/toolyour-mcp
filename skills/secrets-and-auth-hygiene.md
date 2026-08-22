---
id: secrets-and-auth-hygiene
title: Secrets and Auth Hygiene
category: security
description: Scan pasted text for leaked secrets and decode JWT-shaped tokens; verify JWT/webhooks and generate hashes via invoke_tool.
operationIds: secretLeakScanner, jwtDecoder, jwtSignatureVerifier, passwordStrengthChecker, securePasswordGenerator, hashGenerator, hmacGenerator, bcryptHashGenerator, webhookSignatureVerifier, piiScrub
workflowId: secrets-hygiene-job
---

# Secrets and Auth Hygiene Skill

Use this playbook for **token/password/hash/secret-leak/webhook** tasks (not live URL crawling).

## Host contract (any MCP agent)

1. Host reads env/diff/logs from the workspace into `input.text` (do not invent secrets)  
2. `plan_task` (optional, free) → `run_playbook("secrets-and-auth-hygiene", { text })` → `secrets-hygiene-job`  
3. Apply **only** rank-1 `loop.nextActions` (`patchType: config`, `roleHint: config`) — rotate/redact; never commit real secrets  
4. `verify_task` with **cleaned** `input.text` + prior result as `baseline` until `loop.gate` is pass  
5. Stop on `loop.stop`. Do not `invoke_tool` for the same hygiene job  

JWT step is skipped when the paste has no JWT (job stays complete).

## Related one-offs (`invoke_tool` only when asked)

- JWT-first paste → `run_playbook("auth-token-hygiene", { token })`
- Before pasting production logs → `piiScrub` when available
- Verify JWT signature → `jwtSignatureVerifier`
- Webhook header verify → `webhookSignatureVerifier`
- Password / hash helpers → `passwordStrengthChecker` / `hashGenerator` / etc.

## Output

- Match types / warnings only (redacted previews)
- Safe next action (rotate, scrub, verify server-side)
- `gatePolicy: secrets` — any open secret/jwt finding fails until clean

Golden path: `docs/TIER1-GOLDEN-PATH.md`
