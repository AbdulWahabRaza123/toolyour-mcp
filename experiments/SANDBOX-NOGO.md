# Sandbox go / no-go (Phase 5)

**Decision (2026-08-19): NO-GO** for a ToolYour-owned customer execution sandbox (Firecracker, Docker-for-hire, `execution.run`, or any MCP tool that takes an arbitrary shell command).

## Why

- Host agents (Cursor, Claude Code) already own editor, git, and terminal.
- Complementary brand: do not claim this server replaces Cursor or GitHub/Playwright MCP.
- Audit: mixing untrusted code execution into API backends is a security incident generator.
- Safety of undeclared `DROP` / prod commands is **contractual + CI merge gate**, not a kernel.

## What we ship instead

- Frozen host checks (`test` / `lint` / `typecheck` / optional `playwright`) via `toolyour-check-run`
- `decide()` completion, evidence blobs, opt-in merge-gate Action
- Host-declared HIGH/CRITICAL approvals (`job_approve` per `actionId`)

Revisit only as a **new product** go/no-go, not as a control-plane increment.
