---
id: secrets-and-auth-hygiene
title: Secrets and Auth Hygiene
category: security
description: Scan pasted text for leaked secrets, decode JWTs, check password strength, generate passwords/hashes/HMAC/bcrypt for app auth testing.
operationIds: secretLeakScanner, jwtDecoder, passwordStrengthChecker, securePasswordGenerator, hashGenerator, hmacGenerator, bcryptHashGenerator, piiScrub
---

# Secrets and Auth Hygiene Skill

Use this playbook for **token/password/hash/secret-leak** tasks (not live URL crawling).

## Steps

1. `discover_tools` with query `jwt password hash secret hmac bcrypt` if schemas are unclear.
2. `get_tool_schema` before each `invoke_tool`.
3. Map user intent:
   - Pasted env/config/logs → prefer workflow **`secrets-hygiene-job`** (`secretLeakScanner`) or invoke `secretLeakScanner` with `input.text`
   - Before pasting production logs into agents → `piiScrub` (AI tools) when available
   - Paste JWT → `jwtDecoder` (decode only — **never** claim signature verification)
   - “Is this password strong?” → `passwordStrengthChecker` (prefer test strings over production secrets)
   - “Generate a password” → `securePasswordGenerator`
   - “Hash this string” → `hashGenerator` (prefer SHA-256+; warn on MD5/SHA-1 for security-sensitive use)
   - “HMAC this payload” → `hmacGenerator`
   - “bcrypt hash” → `bcryptHashGenerator` (test passwords only)
4. Do not store or echo high-value production secrets in long-term memory; summarize strength / match types only.
5. If JWT-shaped matches appear in a leak scan, optionally `invoke_tool` `jwtDecoder` on a redacted/copy sample the user provides.

## Output format

- What was checked
- Warnings (leaked patterns, alg=none, expired JWT, weak password, legacy hash)
- Safe next action (rotate, lengthen passphrase, verify signature server-side)
