---
id: dev-auth-debug
title: Dev Auth Debug
category: developer
description: Generate test JWTs, decode claims, and inspect request/header helpers for auth debugging.
operationIds: jwtGenerator, jwtDecoder, httpHeadersChecker, httpHeadersCheckerPost, apiRequestBuilder, userAgentParser
workflowId: dev-auth-debug-job
---

# Dev Auth Debug

Use for **JWT / request auth smoke-checks** (test tokens and header inspection). Not a full IdP or production secret manager.

## Preferred path

1. Build a test token → `run_playbook("dev-auth-debug", { … })`  
   - Workflow **`dev-auth-debug-job`**: `jwtGenerator` → `jwtDecoder` (decode ≠ verify)
2. Signature verify / leak scan → security playbooks `auth-token-hygiene` / `secrets-and-auth-hygiene`
3. Live response headers → `invoke_tool("httpHeadersChecker", { url })` or POST `httpHeadersCheckerPost`
4. cURL / request sketch → `apiRequestBuilder`
5. UA parse → `userAgentParser`

## Honest limits

- `jwtGenerator` is **HS / test-use**; do not treat generated tokens as production auth.
- `jwtDecoder` does **not** verify signatures — pair with `jwtSignatureVerifier` when needed.
- `http-headers-checker` is a general dump — not `security-headers-analyzer`.

## Output format

- Token claims / warnings
- Whether signature verify is still needed
- Request builder / header follow-ups
