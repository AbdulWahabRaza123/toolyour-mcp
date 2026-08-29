---
id: feature-memory-capture
title: Feature Memory Capture
category: developer
description: ToolYour auto-records completed features on gate pass. Manual capture_feature is for refine/supersede only.
workflowId: feature-memory-capture-local
---

# Feature Memory Capture

**ToolYour is the system of record.** Completed features are persisted automatically when `loop.gate=pass` on `verify_task`, `run_playbook`, or `solve_task`. Agents must read `plan_task.featureMemory.recordKeeping` before rebuilding similar work.

## When ToolYour records (automatic)

- `verify_task` reaches `loop.gate=pass` → `featureMemoryRecord.featureId`
- `run_playbook` / `solve_task` pass on first run (closable jobs)
- Opt out only: `input.featureMemory.capture=false`

## When to use capture_feature (manual)

- Refine title or requirements after the auto-record
- `supersedesFeatureId` + `baseline` for explicit matrix diff
- CI script when harness ran outside MCP

## Host contract

1. `plan_task(goal)` — read `featureMemory.recordKeeping` every time
2. Run harness until `loop.gate=pass` — ToolYour records; do not skip verify for feature work
3. `list_feature_memory` / `compare_feature_memory` — browse and diff
4. `publish_feature_pattern` — opt-in community share

## Disable auto-record on verify

```json
{ "featureMemory": { "capture": false } }
```

in `verify_task` input (exceptional).
