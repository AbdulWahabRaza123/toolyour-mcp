# Host contract (all MCP agents)

ToolYour measures and prioritizes in the cloud. **You** (Cursor, Claude, Copilot, or any MCP host) apply fixes in the workspace, then call `verify_task`.

## Skill loop (default)

1. `plan_task(goal)` — free. If `loop.initiate` is **false**, **stop** (do not verify). For development verification goals, read `goldenPath`.
2. `run_playbook(...)` or `solve_task(...)` — read **`verification.evidence`** and `loop.gate`, **rank-1** `loop.nextActions`, full `loop.remainingFixes`.
3. Apply **only** the rank-1 item. Use `patchType`, `acceptance`, and `roleHint` (`edit` | `config` | `read` | `shell`) as advice — not as a Cursor Task type.
4. `verify_task(goal, input, baseline=<entire prior result>)` until `loop.gate` is `pass`, **or** stop when `loop.stop` / `loop.initiate` is false. Optional `profileId` reuses stored snapshots when baseline is omitted.
5. Do **not** `invoke_tool` for the same ship / SEO / security / secrets job.
6. Never pass `localhost` URLs — use workspace HTML/text/code or a public/preview `https://` URL.

## Development verification

For goals like “verify my preview deploy” or “make this production ready”:

- `plan_task` recommends `production-readiness-gate` and returns `goldenPath`.
- First `run_playbook(..., { url })` with `https://` auto-creates a **verification profile** (`profileId` in the response).
- Each run attaches `verification.evidence[]` and optional `verification.regressionAlert` vs the last verified pass.
- Reuse `profileId` across `run_playbook` and `verify_task` so ToolYour persists baselines server-side.

See [DEVELOPMENT-VERIFICATION-GUIDE.md](./DEVELOPMENT-VERIFICATION-GUIDE.md).

## Credits

Credits buy **evidence and re-checks**. Incomplete / out-of-scope / blocked runs are **not** a pass. Prefer closing the gate over re-running random tools.

## Tier-1 jobs

See [TIER1-GOLDEN-PATH.md](./TIER1-GOLDEN-PATH.md) for ship-gate, SEO, and secrets demos.
