---
id: secrets-and-auth-hygiene
title: Secrets and Auth Hygiene
category: security
description: Scan pasted text for leaked secrets, decode/verify JWTs, check password strength, generate passwords/hashes/HMAC/bcrypt/Argon2, and verify webhook signatures.
operationIds: secretLeakScanner, jwtDecoder, jwtSignatureVerifier, passwordStrengthChecker, securePasswordGenerator, hashGenerator, hmacGenerator, bcryptHashGenerator, webhookSignatureVerifier, piiScrub
---

# Secrets and Auth Hygiene Skill

Use this playbook for **token/password/hash/secret-leak/webhook** tasks (not live URL crawling).

## Steps

1. `discover_tools` with query `jwt password hash secret hmac webhook` if schemas are unclear.
2. `get_tool_schema` before each `invoke_tool`.
3. Map user intent:
   - Pasted env/config/logs → **`secrets-hygiene-job`** or `secretLeakScanner` (`input.text`)
   - Before pasting production logs → `piiScrub` when available
   - Paste JWT decode-only → `jwtDecoder`
   - Verify JWT signature → `jwtSignatureVerifier` (secret or publicKey/JWK)
   - Webhook header verify → `webhookSignatureVerifier` (GitHub/Stripe/generic)
   - Password strength / generate → `passwordStrengthChecker` / `securePasswordGenerator`
   - Hash / HMAC / bcrypt|argon2id → `hashGenerator` / `hmacGenerator` / `bcryptHashGenerator`
4. Do not store production secrets; summarize match types / verify results only.

## Output format

- What was checked
- Warnings (leaks, alg=none, signature mismatch, weak password)
- Safe next action (rotate, verify server-side, use Argon2id for new password stores)
