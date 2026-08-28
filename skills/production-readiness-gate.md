---
id: production-readiness-gate
title: Production Readiness Gate
category: developer
description: Verify a preview or staging URL until ship-gate passes — headers, TLS, mixed content, HTTP status, page-speed proxy. For AI-assisted development loops.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# Production Readiness Gate

Use when a **host agent** (any MCP client) is iterating on code and needs **objective external verification** before merge or deploy.

Same workflow as **ship-gate** — this skill id signals the **development verification loop**: run → evidence → host fix → verify → pass.

## When to use

- "Make this production ready"
- "Verify my preview deploy"
- "Run ship gate before merge"
- "Check staging before release"

**Requires** a public `https://` preview URL (Vercel, Railway, Netlify, tunnel). **Never localhost** for live fetch.

## Host contract (any MCP agent)

1. `plan_task(goal)` — free; read `goldenPath` and `loop.initiate`
2. `run_playbook("production-readiness-gate", { url })` — read **`verification.evidence`** and `loop.line` first
3. Apply **only** `loop.nextActions[0]` in the workspace (`patchType`, `acceptance`, `roleHint`)
4. Redeploy preview if config/headers changed
5. `verify_task(goal, { url, profileId }, baseline=<entire prior result>)`
6. Repeat until `loop.gate` is `pass` or `loop.stop`

`profileId` is returned on first run when `url` is https — reuse it so ToolYour persists baselines and regression vs last verified pass.

## Output

- `verification.evidence[]` — agent-optimized findings with acceptance criteria
- `verification.regressionAlert` — when scores/findings regressed vs last verified pass
- `loop.remainingFixes` / `loop.nextActions` — harness loop (unchanged)

Do **not** `invoke_tool` for the same job.
