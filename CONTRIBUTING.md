# Contributing (ToolYour MCP)

MIT licensed. Improvements that strengthen **plan → run → verify** without replacing the host agent are welcome.

## Before a PR

```bash
npm install
npm run ci
```

Offline only — no API key required for `ci`.

## Where to help

| Area | Path |
|------|------|
| Playbook skills | `skills/*.md` |
| Skill → workflow map | `src/orchestrator/playbook-map.ts` |
| Offline fixtures | `tests/eval/synth-fixtures.json` |
| Routing goals | `tests/eval/goals.jsonl` |
| Verify / gate logic | `src/orchestrator/verify-task.ts` |
| Open tracing | `src/observability/tracing.ts` |

Raising `eval:playbooks` fixture coverage is especially valuable.

## Do not

- Add closed-source APM SDKs as hard dependencies
- Claim ToolYour replaces Cursor/Claude
- Commit `.env`, API keys, or control-plane tokens
