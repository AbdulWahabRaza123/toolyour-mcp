# Agent harness migration (ToolYour MCP)

**Status:** In progress (Phase A started)  
**Last updated:** 2026-08-02  
**Related:** [`MCP-JOBS-ROADMAP.md`](./MCP-JOBS-ROADMAP.md) · [`CI-AGENT-LOOP.md`](./CI-AGENT-LOOP.md)

## Honest claim boundaries

| Claim we **can** defend | Claim we **must not** make |
|-------------------------|----------------------------|
| Agents use ToolYour MCP as their **practical tool + verify layer** (SEO, security, ship-gate, docs, conversion) | ToolYour **replaces** Cursor/Claude as the agent runtime (LLM, context window, editor tools) |
| `plan_task` → `solve_task` / `run_playbook` → `verify_task` is a **shared harness contract** any client can adopt | We are a fully autonomous multi-agent OS |
| Teams can **delete custom SEO/ship/security glue** and call our meta-tools instead | Every agent capability (git, terminal, browser farm) lives on our MCP |

**Translation:** We replace *domain harnesses* (the scripts and ad-hoc tools teams build around audits and ship checks). We do **not** replace the host agent’s brain.

Later we will prove (not assume) this with a **test agent** that only uses ToolYour MCP meta-tools for ship/SEO/security loops and compares pass rates vs a baseline agent with hand-rolled tools.

---

## Side-by-side: host harness vs ToolYour MCP

| Host agent still owns | Migrate **onto** ToolYour MCP |
|-----------------------|-------------------------------|
| Model choice, prompts, memory | Job routing (`solve_task` / skills) |
| Editor / git / terminal | Job reports + `verify_task` deltas |
| General web browsing (optional) | Ship-gate, security headers, SEO, CWV, email auth |
| Product-specific business APIs | Doc convert pipelines, text utilities |
| Orchestration policy | Credit-aware `plan_task`, async `get_run` |

### Migration playbook for agent builders

1. Keep host loop: reason → call tools → apply patches → reason.  
2. Replace custom “run Lighthouse / headers / SEO scrape” with `run_playbook` or `solve_task`.  
3. Persist last `jobReport` (or full solve payload) as **baseline**.  
4. After edits, call `verify_task(goal, input, baseline)` and read **`delta.remainingFixes` / `delta.nextActions` / `delta.gate`**.  
5. Stop when `delta.gate === "pass"` or host policy allows residual medium/low findings.  
6. Optional: `async:true` + poll `get_run` in CI ([`CI-AGENT-LOOP.md`](./CI-AGENT-LOOP.md)).

---

## Build phases (execution)

### Phase A — Prove the loop (this PR / sprint)

| Deliverable | Done when |
|-------------|-----------|
| Structured `verify_task` remaining fixes + gate | Agents get machine-readable next steps without digging into `after` |
| Golden eval harness | `npm run eval:golden` asserts routing + required job report fields |
| CI agent-loop docs | Poll-first pattern; webhook optional |
| This migration doc | Claim boundaries explicit |

### Phase B — Make migration sticky

| Deliverable | Status | Notes |
|-------------|--------|-------|
| GitHub Action example | Done | `examples/github-actions/ship-gate.yml` + `scripts/ci-ship-gate.mjs` |
| SDK helpers | Done | `@toolyour/sdk/mcp` → `verifyUntilPass`, `planAndSolve`, `extractJobReport` (0.1.2+) |
| Eval matrix live runs (opt-in) | Optional | `smoke:live:agent` / staging with API key |
| Fix-pack richness | Ongoing | Prefer ≥1 actionable `howToFix` on high findings |

### Phase C — External proof agent (your planned test)

| Deliverable | Notes |
|-------------|-------|
| Thin test agent | Only ToolYour MCP for domain jobs |
| Baseline agent | Same goals with local/custom tools |
| Scorecard | Pass rate, steps, credits, time |
| Go/no-go | Adjust marketing claim to measured truth |

---

## What not to build yet

- Mass thin converters (does not migrate harnesses)  
- Browser-only tools without `hasApi` (invisible to MCP)  
- Claiming “replace Cursor harness” in blogs/docs before Phase C evidence
