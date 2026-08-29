# Feature Memory (MCP hot path)

Cross-project **feature memory** for AI agents. **ToolYour is the system of record** — completed features are persisted automatically; agents consult memory before rebuilding.

## Architecture

```text
Agent → MCP (plan_task | solve_task | run_playbook | verify_task)
           ↓ auto-record on loop.gate=pass
     SaaS internal API (/internal/feature-memory)
           ↓
     MongoDB FeatureMemory + FeatureMemoryNotification
```

MCP never talks to Mongo directly. Private per account by default; opt-in **community** patterns redact project/repo labels.

## System-first record keeping

| Trigger | What ToolYour does |
|---------|-------------------|
| `verify_task` → `loop.gate=pass` | Auto-records requirements + evaluation matrix → `featureMemoryRecord` |
| `run_playbook` / `solve_task` → `loop.gate=pass` | Same (closable jobs that pass without a separate verify) |
| `plan_task` | Always returns `featureMemory.recordKeeping` + prior matches when found |
| `capture_feature` | **Manual refine only** — adjust title/requirements or supersede |

Opt out: `input.featureMemory.capture=false` (exceptional; default is record).

## Meta-tools

| Tool | Bills? | Role |
|------|--------|------|
| `plan_task` | Free | `featureMemory.recordKeeping` + reminders for similar prior work |
| `verify_task` | Like solve | Auto-records on pass → `featureMemoryRecord` |
| `capture_feature` | Free | Manual refine / supersede (not the primary capture path) |
| `list_feature_memory` | Free | Browse captured features by domain |
| `compare_feature_memory` | Free | Side-by-side matrix diff |
| `publish_feature_pattern` | Free | Opt-in community share |
| `list_community_patterns` | Free | Browse community library |

## Matching (hybrid embedding)

35% token overlap + 65% requirements embedding. `matchMethod: "hybrid_embedding"`.

## Response envelope (plan_task)

```json
{
  "featureMemory": {
    "schemaVersion": "toolyour.featureMemory@1",
    "recordKeeping": {
      "policy": "toolyour_auto_record",
      "message": "ToolYour is your cross-project institutional memory…"
    },
    "domain": "ocr",
    "matchConfidence": "high",
    "bestKnown": { "featureId": "fm_…" }
  }
}
```

## Response on pass (verify / playbook / solve)

```json
{
  "featureMemoryRecord": {
    "status": "recorded",
    "policy": "toolyour_auto_record",
    "featureId": "fm_…",
    "message": "ToolYour recorded this completed feature…"
  }
}
```

## Env

- `FEATURE_MEMORY_URL` (optional)
- `SAAS_INTERNAL_SECRET` — required

## Indexes

`cd toolyour-saas && npm run migrate:ensure-indexes`
