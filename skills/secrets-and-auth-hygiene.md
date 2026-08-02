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

## Preferred path

1. Pasted env/config/logs → **`run_playbook("secrets-and-auth-hygiene", { text })`** → `secrets-hygiene-job`
   - Steps: secretLeakScanner → jwtDecoder (when a JWT is present in the text)
2. JWT-first paste → `run_playbook("auth-token-hygiene", { token })`
3. Before pasting production logs → `piiScrub` when available
4. Verify JWT signature → `jwtSignatureVerifier` (secret or publicKey/JWK)
5. Webhook header verify → `webhookSignatureVerifier`
6. Password strength / generate → `passwordStrengthChecker` / `securePasswordGenerator`
7. Hash / HMAC / bcrypt|argon2id → `hashGenerator` / `hmacGenerator` / `bcryptHashGenerator`
8. Do not store production secrets; summarize match types / verify results only.

## Output format

- What was checked
- Warnings (leaks, alg=none, signature mismatch, weak password)
- Safe next action (rotate, verify server-side, use Argon2id for new password stores)
