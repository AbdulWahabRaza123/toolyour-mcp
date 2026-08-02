---
id: auth-token-hygiene
title: Auth Token Hygiene
category: security
description: Decode pasted JWTs and scan surrounding text for leaked secrets; verify signatures/webhooks via invoke_tool.
operationIds: jwtDecoder, secretLeakScanner, jwtSignatureVerifier, webhookSignatureVerifier, hmacGenerator, piiScrub
workflowId: auth-token-hygiene-job
---

# Auth Token Hygiene Skill

Use for **JWT / webhook / token** tasks on pasted material (not live URL crawling).

## Preferred path

1. Paste token or logs → `run_playbook("auth-token-hygiene", { text })` or `{ token }`
   - Workflow **`auth-token-hygiene-job`**: jwtDecoder → secretLeakScanner
2. Signature verify → `invoke_tool("jwtSignatureVerifier", { token, secret|publicKey })`
3. Webhook header verify → `invoke_tool("webhookSignatureVerifier", …)`
4. Digest-only → `hmacGenerator`
5. Scrub PII before pasting prod logs → `piiScrub`
6. Env dump without JWT focus → `secrets-and-auth-hygiene` / `secrets-hygiene-job`

## Output format

- Decode warnings (alg=none, expiry)
- Leak match types (never echo full secrets)
- Whether signature/webhook verify still needed
