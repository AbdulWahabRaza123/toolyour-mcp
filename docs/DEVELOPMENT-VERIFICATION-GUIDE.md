# Development Verification Guide

Host-neutral loop for AI-assisted development: any MCP client can depend on ToolYour for **objective external verification** after code changes.

## Problem

Without ToolYour, host agents guess whether a preview deploy is production-ready. With ToolYour:

- Structured `verification.evidence[]` with acceptance criteria
- Durable `profileId` baselines across sessions
- `verification.regressionAlert` when scores/findings regress vs last verified pass
- Existing harness loop (`loop.nextActions`, `loop.gate`, `verify_task` deltas)

## Golden path

```
plan_task("verify my preview deploy is production ready")
  → goldenPath + recommended playbook: production-readiness-gate

run_playbook("production-readiness-gate", { url: "https://preview.example.com" })
  → verification.evidence, loop.nextActions[0], profileId (auto-created)

[host applies rank-1 fix, redeploys preview]

verify_task(goal, { url, profileId }, baseline=<entire prior run_playbook result>)
  → delta vs baseline, verification.regressionAlert, loop.gate

repeat until loop.gate === "pass" or loop.stop
```

## MCP parameters

| Tool | New / optional input | Purpose |
|------|---------------------|---------|
| `run_playbook` | `profileId`, `autoProfile` (default true) | Reuse profile; auto-create on first `https://` URL |
| `verify_task` | `profileId` | Load `lastRunSnapshot` when `baseline` omitted |

No new MCP tools in MVP — profiles are internal to existing meta-tools.

## Response envelope

```json
{
  "verification": {
    "schemaVersion": "toolyour.verification@1",
    "profileId": "vp_…",
    "targetUrl": "https://…",
    "playbook": "production-readiness-gate",
    "runId": "run_…",
    "evidence": [
      {
        "id": "ev_…",
        "severity": "high",
        "title": "Missing HSTS",
        "status": "failed",
        "acceptance": "Add Strict-Transport-Security header"
      }
    ],
    "regressionAlert": "…",
    "goldenPath": ["…"]
  },
  "loop": { "gate": "fail", "nextActions": […] }
}
```

## Bridges

| Environment | Input |
|-------------|-------|
| Preview deploy (primary) | Public `https://` URL |
| Local iteration (secondary) | `content-ship` with `input.html` / `input.text` |
| Localhost | Blocked — tunnel or deploy first |

## SaaS storage

Verification profiles live in `toolyour-saas` (MongoDB), accessed by MCP via internal routes:

- `POST /internal/verification-profiles`
- `GET /internal/verification-profiles/:profileId`
- `PATCH /internal/verification-profiles/:profileId`

Requires `SAAS_INTERNAL_SECRET` on MCP and `verificationProfilesUrl` (derived from `SAAS_VALIDATE_URL` base).

## Skills

- `production-readiness-gate` — alias playbook id for dev verification (workflow: `ship-gate-job`)
- `ship-gate`, `pr-preview-gate` — same workflow, different positioning

## Host rules

1. Read `verification.evidence` before `loop.remainingFixes`.
2. Apply **only** `loop.nextActions[0]` per round.
3. Pass the **entire** prior result as `baseline` (or rely on `profileId` after first run).
4. Do not `invoke_tool` for the same job.
5. Never pass localhost URLs for live fetch playbooks.
