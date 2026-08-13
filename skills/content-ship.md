---
id: content-ship
title: Content Ship Local
category: content
description: Local HTML/content ship checklist without a deployed URL — free on-page analysis unless enhance:true.
operationIds: contentOptimization, headlineRestructurer
workflowId: content-ship-local
---

# Content Ship Local Skill

Use when the user has **unpublished HTML** or pasted copy and wants a ship checklist. **Files/HTML first** — do not ask for a public URL.

## Preferred path

1. `run_playbook("content-ship", { html: "…" })` — local analysis free by default
2. Set `enhance: true` only if you want billed text APIs (headline/jargon/etc.)
3. Summarize critical/warning issues and next edits

## Output

- Score + critical issues
- Next steps for the author
- Remind that CWV/speed needs a public URL
