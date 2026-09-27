# Open-source ToolYour MCP

Remote MCP gateway for AI agents: **plan → run playbook/solve → verify until pass**.

MIT licensed. Hosted API/SaaS backends are optional — offline evals and local file control-plane run without them.

**Product docs:** https://www.toolyour.com/developers/mcp  
**Official registry:** `com.toolyour/mcp`  
**npm client (separate):** [@toolyour/sdk](https://github.com/ToolYour/toolyour-sdk) (MIT)

## Quick start

```bash
cp .env.example .env
npm install
npm run build:registry   # from monorepo docs/ when regenerating
npm run build
npm run dev
```

Endpoint: `http://localhost:3090/mcp` (SSE) · Streamable HTTP: `/mcp/http`

Health: `GET /health/mcp` · Ready: `GET /health/mcp/ready` · Metrics: `GET /health/mcp/metrics` (Prometheus text)

## Auth

```
X-Api-Key: ty_...
```

Same key as ToolYour REST. Free tier: 500 credits/month (tools cost 1–10 credits). MCP exposes **API-backed catalog tools only** (`hasApi`).

## Host contract

ToolYour does **not** replace Cursor/Claude. The host keeps editor, git, and terminal. Agents should:

1. `plan_task` (free)
2. `run_playbook` or `solve_task`
3. Apply **only** rank-1 `loop.nextActions` in the workspace
4. `verify_task` with prior result as baseline until `loop.gate` is `pass` (or stop)

Skill-loop responses also include an additive `execution` envelope (`runId`, `intentId`,
`intentType`, `idempotencyKey`, and `projectScope`). Preserve it when handing a result to
another MCP tool. Async jobs reuse `execution.runId` as the `get_run` polling id.

Internally, `plan_task`, `solve_task`, `run_playbook`, `run_workflow`, and `verify_task` use
one `executeIntent` lifecycle boundary for correlation and the `execution` envelope.
Credits settle on each gateway tool invoke (`billing.settledBy = gateway_per_tool`) — MCP
does not double-bill. Free `recall_context` recalls purpose-typed memory before rebuilds.

## Saved Playbooks (private beta)

Saved Playbooks turns a repeatable ToolYour workflow into a named, versioned recipe that an
MCP-capable agent can run again. V1 deliberately points only to **existing ToolYour skills or
workflows**; it does not store arbitrary shell commands, control another agent, or bypass host
approval. Each account gets owner-scoped playbooks and durable run receipts.

Enable this only on a private/default MCP deployment with `PLAYBOOKS_BETA=true`. The beta adds
`create_saved_playbook`, `list_saved_playbooks`, `get_saved_playbook`, `update_saved_playbook`,
`run_saved_playbook`, and `get_saved_playbook_run`. It is intentionally excluded from
`/mcp/chatgpt` so the reviewed public 21-tool surface stays unchanged.

See [Saved Playbooks beta design](./docs/SAVED-PLAYBOOKS-BETA.md) for the data model, safe
execution boundary, and rollout guidance.

## Offline evals (no API key)

```bash
npm run ci                 # build + lint + unit/contract/integration + evals
npm run eval:golden        # routing + jobReport fields + verify gate
npm run eval:playbooks     # skill → workflow → synthesizer matrix + fixture coverage
npm run golden:tier1       # host work-package shapes
```

Fixtures: `tests/eval/synth-fixtures.json` · Goals: `tests/eval/goals.jsonl`

## Observability (open protocols)

| Signal | How |
|--------|-----|
| JSON logs | Always (`LOG_LEVEL`) |
| In-process counters | `/health/mcp` + `/health/mcp/metrics` |
| Spans | Set `OTEL_LOG_SPANS=1` and/or `OTEL_EXPORTER_OTLP_ENDPOINT` (OTLP/HTTP JSON → Collector / Jaeger / Tempo) |

No proprietary APM required.

## What stays hosted (optional)

- Live tool execution via gateway + API key
- Feature Memory / verification profiles (SaaS Mongo)
- Redis for multi-replica async `get_run`

Local defaults use file-backed control-plane jobs.

## License

MIT — see [LICENSE](./LICENSE).
