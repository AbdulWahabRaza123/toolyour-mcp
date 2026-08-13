---
id: pr-preview-gate
title: PR Preview Gate
category: developer
description: Pass/fail gate for preview/PR deploy URLs — same checks as ship-gate (headers, TLS, mixed content, status, speed).
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# PR Preview Gate

Use when the URL is a **preview, PR, or ephemeral deploy** and the user wants a go/no-go **on that live link**.

If they have **changed files** and no preview URL, use `pr-code-gate` instead — do not ask them to deploy first.

## Preferred path

1. `run_playbook("pr-preview-gate", { url: "https://preview…" })`
2. Or `solve_task("preview ship gate for https://…")`
3. After fixes: `verify_task` with baseline, or `run_playbook("fix-verify-ship-gate", { url })`

## Output

- Same pass/fail shape as `ship-gate`
- Do not claim production-ready without human QA
- For production final gate, prefer `ship-gate` naming in CI
