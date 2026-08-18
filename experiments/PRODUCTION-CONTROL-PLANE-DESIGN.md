# Production control plane — design (not shipped)

**Status:** Draft for human review. **Not implemented. Flag off in production.**  
**Date:** 2026-08-18  
**Gate:** [`SCORECARD-GATE.md`](./SCORECARD-GATE.md) — GO for design, NO-GO for deploy.  
**Audit:** [`AUTONOMOUS-EXECUTION-AUDIT.md`](../../docs/AUTONOMOUS-EXECUTION-AUDIT.md) §5 / §15 / §16 — MODIFY (B).  
**Experiment code:** `toolyour-mcp` branch `experiment/control-plane-mvp` (local only).

This document is the protocol step-5 deliverable. It is **not** permission to set `CONTROL_PLANE_EXPERIMENT=true` on Railway or `api.toolyour.com`.

---

## 1. Product boundary (locked)

ToolYour stays a **control / verify plane**. Host agents (Cursor, Claude, CI) keep editor, git, terminal, and tests.

| ToolYour owns | Host owns |
|---|---|
| Frozen spec + acceptance criteria | Patches, commits, `npm test` |
| Allowlisted check catalog | Shell, filesystem, secrets |
| Deterministic `decide()` | How to fix failing checks |
| Job ledger + evidence hashes | Whether to merge |
| `verified` / `escalated` / `cancelled` | Editor UX |

Never: customer sandbox, `execution.run` with a free-form command, “replaces Cursor,” ToolYour-run `node --test`.

Reliability promise is **levels 1–2** from the audit (host-reported tests + independent gate). Level 3 (remaining coding work mapped to failed checks) is the stretch. Levels 5–7 are out.

---

## 2. What the experiment constrains

Keep these behaviors. They are the product.

| Experiment fact | Production rule |
|---|---|
| No `job_complete`. Chat “I’m done” does not change state. | Same. Terminal states come only from `decide()`. |
| Forged `check_submit` pass without runner token/nonce is rejected. | Signed host CLI; server never trusts agent-invented pass. |
| Gutting/deleting tests → inventory SHA-256 fail → **not** `verified`. | Frozen check inventory (file hash or required check ids) is blocking. |
| Flag-on **replaces** the 13 catalog tools. | **Forbidden in prod.** New tools are **additive**. |
| Dummy key `ty_experiment`, local `jobs.json`. | Real `ty_` keys via SaaS `validate-key`. Durable store in SaaS Mongo. |
| Frozen tasks `task-1`…`task-5` only. | Customer jobs from **templates** (ship-gate / SEO / security) plus optional host-check spec. Commands stay allowlisted. |
| `job_start` experimenter-only. | Customers may start jobs; they cannot weaken a frozen spec. |

---

## 3. Architecture (extend, don’t replace)

```text
Host agent / CI
  editor, git, terminal, tests
        │  MCP  X-Api-Key (same ty_ key as REST)
        ▼
api.toolyour.com/mcp     ← existing nginx path; no new public URL required for MVP
        │
        ├─ plan_task / solve_task / run_playbook / verify_task / invoke_tool
        │     (unchanged catalog — always registered)
        │
        └─ job_start / job_status / check_submit / job_cancel
              ADDITIVE, opt-in per key or plan flag — never hide catalog tools
                    │
                    ├ decide() in toolyour-mcp (reuse R0–R8)
                    ├ Job documents in toolyour-saas Mongo
                    ├ Remote checks → existing hasApi workflows (bill 1–10 credits)
                    └ Host checks → @toolyour/sdk CLI only (signed results)
```

`runStore` (1h MCP run) stays for `solve_task` / `verify_task` batches. It is **not** the durable Job. Map: one Job iteration may include one or more existing `get_run` ids for remote checks.

---

## 4. MCP surface

### Always on (production today)

`plan_task`, `solve_task`, `run_playbook`, `verify_task`, `get_run`, `discover_tools`, `invoke_tool`, and the rest of the current catalog. Instructions stay: host keeps editor/git/terminal; do not claim this server replaces Cursor.

### Additive (after review; default off)

| Tool | Who | Notes |
|---|---|---|
| `job_start` | Customer | Body: `templateId` **or** `spec` JSON. Server freezes spec hash. Issues one-time runner credential (not echoed later). |
| `job_status` | Agent | Envelope from the experiment: `state`, `next_action`, `remaining_requirements`, `specHash`, `iteration`. No secrets. |
| `check_submit` | **CLI only** | Reject if not signed with the per-job nonce + account runner HMAC. Agents must not invent results. |
| `job_cancel` | Customer / agent | Open jobs only. |

Opt-in: SaaS plan or key metadata `controlPlane: true`. Unset → these four tools are **absent**, catalog unchanged. This is the opposite of `CONTROL_PLANE_EXPERIMENT=true` (which must never ship).

Implementation note (2026-08-18, local only): `CONTROL_PLANE_ADDITIVE=true` registers catalog first, then job tools. `CONTROL_PLANE_EXPERIMENT=true` still isolates (hides catalog). Additive default is off. Never set either flag on `api.toolyour.com`.

---

## 5. Signed host CLI (`@toolyour/sdk`)

Publish a bin, e.g. `toolyour-check-run --job <id> --cwd <repo>` (source in `@toolyour/sdk`; not an npm release until you tag).

1. `job_status` over MCP (same URL/key as the agent).
2. Execute **only** `Check.command` strings frozen on the job (allowlist at `job_start`).
3. Compute `fingerprint`, `treeHash` (lib/tests or declared roots), optional `gitSha` if cwd is that repo’s git root.
4. `check_submit` with HMAC(`jobId | nonce | treeHash | results`).

Nonce lives in OS temp or a secrets dir, never in MCP responses (same as the experiment). Forged pass without the CLI is rejected.

Do **not** put `node --test` inside `toolyour-mcp`.

CI: GitHub Action wraps the same CLI and fails the merge unless `job.state === verified` (phase 2).

---

## 6. Durable Job + frozen spec

**Store:** SaaS Mongo collections `ControlPlaneJob`, `ControlPlaneIteration` (names TBD). MCP process is stateless beyond cache. TTL days (reuse experiment `JOB_TTL_MS` = 7d as default), not 1 hour.

**States (MVP subset of the audit machine):**

```text
open → verified | escalated | cancelled
```

Do not ship `discovering` / `spec_review` until host discovery artifacts exist. Templates skip discovery.

**Spec (`toolyour.projectSpec@1`):**

- `goal`, `acceptance[]` (`id`, `statement`, `requiredCheckIds`), `checks[]` (`id`, `kind`, `executor: host|remote`, `command` or `workflowId`, `blocking`)
- Immutable after `job_start`. Amendments require a new job or a future `spec.amend` + human approval (not in MVP).
- `specHash` on every `job_status`. Mismatch → reject submit.

**Host check kinds (MVP):** `test`, `lint`, `typecheck` — commands from an allowlist (e.g. `node --test …`, `npm test`, `npx tsc --noEmit`). No `bash -c`.

**Remote check kinds:** existing `hasApi` workflows only (`ship-gate`, SEO, security playbooks). Params freeze URL + (if available) TLS identity at start so stub hosts cannot silently replace the target.

**Inventory:** for host test files listed in spec, SHA-256 like the experiment. Missing or rewritten file → fail, not pass.

---

## 7. `hasApi` catalog jobs

MCP jobs may only attach **API-backed** tools (`hasApi: true`). Browser-only catalog entries stay off MCP.

Templates (first ship):

| templateId | Remote checks | Host checks |
|---|---|---|
| `ship-gate` | Existing ship-gate workflow | optional |
| `seo-audit` | Existing SEO playbook | optional |
| `security-audit` | Existing security playbook | optional |
| `host-tests` | none | customer allowlisted test/lint/tsc |

URL verify keeps today’s `verify_task` gate for remote-only jobs. Coding jobs **must not** use “no high findings” as the sole completion oracle (audit §6). Completion = all blocking checks pass **and** every frozen AC maps to a passing check (experiment R6).

---

## 8. Auth, credits, quota

- Same `ty_` key, `X-Api-Key`, SaaS `validate-key`. No dummy experiment key in prod.
- **Credits** (never “requests”): `job_status` / `job_cancel` free (like `plan_task`). `job_start` 1 credit. Each `check_submit` **iteration** 1 credit plus whatever remote workflows already cost (1–10 per tool). Cap iterations with `maxIterations` (default 8) so loops cannot drain the 500 free credits unnoticed.
- Shared REST+MCP monthly quota unchanged (`brand.product.apiFreeTierCredits` = 500).

---

## 9. Decision engine

Reuse `toolyour-mcp/src/control-plane/decide.ts` (R0–R8) as the coding-job oracle:

| Rule | Role |
|---|---|
| R1 | Reject submit missing required checks |
| R3 / R8 | Same fail fingerprint or same `treeHash` × `repeatFailN` → escalate |
| R4 | `maxIterations` without pass → escalate |
| R5 | Required check failed → `continue` + `next_action` |
| R6 | All required pass and every AC mapped → `verified` |

Do not let the agent call `decide()`. Do not add an LLM as completion decider.

---

## 10. Phases (implementation — after this review)

| Phase | What | Exit | Do now? |
|---|---|---|---|
| **0** | This design + keep flag off + keep complementary brand | Human review of this doc | **This is the end of the experiment loop** |
| **1** | Additive tools, Mongo jobs, SDK CLI, host test/lint/tsc, `decide()` | Dogfood on ToolYour PRs | No — blocked on review |
| **2** | Evidence blobs + GitHub Action merge gate | One design partner | No |
| **3** | Narrow approvals for HIGH host-declared actions | Approval UX | No |
| **4** | Optional host Playwright as CheckResult | Only if phase 2 is used | No |
| **5** | Third-party sandbox | New product go/no-go | **Maybe never** |

Kill-gate before any prod binary with job tools: `npm run build && npm run test:mcp:unit && node scripts/eval-control-plane.mjs` **plus** a test that catalog tools remain registered when job tools are on.

---

## 11. Coupling (when phase 1 is approved — do not apply yet)

| Change | Also update |
|---|---|
| Additive MCP tools | Customer MDX `mcp-*`; `brand.ts` / `llms.txt` (complementary, host CLI); fact pack `mcp.json`; `/developers/mcp` |
| Jobs / quota | `platform.json` + `mcp.json`; pricing copy still **credits** |
| SDK CLI | `toolyour-sdk` release; `/developers` link when published |
| SaaS Mongo jobs | `toolyour-saas` only; MCP stays thin |
| `hasApi` templates | Registry + `build:mcp-registry`; do not expose browser-only tools |
| Gateway | Prefer existing `/mcp`. New path needs `infra` nginx + env examples |
| Public docs URL | Allowlist only after 200 in prod |

Do **not** update brand to “replaces Cursor.” Non-goal `replacing-cursor-claude-harness` stays.

---

## 12. Explicit non-goals

- `CONTROL_PLANE_EXPERIMENT=true` on production
- Replacing catalog tools when job tools are enabled
- Mongo / nginx / validate-key wiring **before** this design is reviewed
- ToolYour-owned Firecracker/Docker customer runtime
- `check_submit` from the agent with invented pass
- Weakening frozen specs to make tests go green
- Mass converter strategy change, underscore URL 301s
- Marketing “autonomous until verified” until Phase C of the **current** URL loop is measured (`HARNESS-STORY-MODULE.md`)

---

## 13. Review checklist (human)

- [ ] Additive registration (catalog never dropped)
- [ ] Completion = `decide()`, not agent speech
- [ ] Host CLI is the only `check_submit` path
- [ ] Inventory / frozen spec cannot be gutted to `verified`
- [ ] Credits language; no “500 requests”
- [ ] Flag / opt-in default **off**
- [ ] No deploy of `experiment/control-plane-mvp` as production MCP
