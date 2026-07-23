---
id: secrets-and-auth-hygiene
title: Secrets and Auth Hygiene
category: security
description: Decode JWTs, check password strength, generate passwords, and compute message digests for app auth testing.
operationIds: jwtDecoder, passwordStrengthChecker, securePasswordGenerator, hashGenerator
---

# Secrets and Auth Hygiene Skill

Use this playbook for **token/password/hash** tasks (not live URL crawling).

## Steps

1. `discover_tools` with query `jwt password hash` if schemas are unclear.
2. `get_tool_schema` before each `invoke_tool`.
3. Map user intent:
   - Paste JWT → `jwtDecoder` (decode only — **never** claim signature verification)
   - “Is this password strong?” → `passwordStrengthChecker` (prefer test strings over production secrets)
   - “Generate a password” → `securePasswordGenerator`
   - “Hash this string” → `hashGenerator` (prefer SHA-256+; warn on MD5/SHA-1 for security-sensitive use)
4. Do not store or echo high-value production secrets in long-term memory; summarize strength / claims only.
5. For pasted config/env leak scans or bcrypt/HMAC, wait for Phase 2 tools (`secretLeakScanner`, `bcryptHashGenerator`, `hmacGenerator`) — say they are not available yet if missing from `discover_tools`.

## Output format

- What was checked
- Warnings (alg=none, expired JWT, weak password, legacy hash)
- Safe next action (rotate, lengthen passphrase, verify signature server-side)
