# Feature Memory — architecture (MCP hot path)

**Status:** Phases 1–5 implemented (2026-08-28)  
**User guide:** [FEATURE-MEMORY-GUIDE.md](./FEATURE-MEMORY-GUIDE.md)

## Problem

Host agents (Cursor, Claude, …) are **tab- and repo-siloed**. Users rebuild similar features without remembering what worked in another project. ToolYour becomes **cross-project institutional memory** for agents.

## Design principles

1. **Event-driven capture** — not passive file watching. Host or verify pass triggers storage.
2. **MCP → SaaS API → Mongo** — same pattern as VerificationProfile; MCP never holds durable state.
3. **Private by default** — community publish is explicit opt-in; project/repo redacted on publish.
4. **Evidence over opinions** — 10-dimension evaluation matrix + composite score; comparisons are numeric.
5. **Free meta-tools** — `plan_task`, `capture_feature`, `list_feature_memory`, `compare_feature_memory`, `publish_feature_pattern`, `list_community_patterns` do not bill credits.

## Stack placement

```text
┌─────────────────────────────────────────────────────────┐
│  Host agent (any MCP client)                             │
│  plan_task · capture_feature · verify_task               │
└───────────────────────────┬─────────────────────────────┘
                            │ X-Api-Key
┌───────────────────────────▼─────────────────────────────┐
│  toolyour-mcp                                            │
│  feature-memory-loop · evaluation-matrix · feature-domain│
│  featureMemory envelope on plan_task                     │
└───────────────────────────┬─────────────────────────────┘
                            │ X-SaaS-Secret
┌───────────────────────────▼─────────────────────────────┐
│  toolyour-saas /internal/feature-memory                 │
│  FeatureMemory + FeatureMemoryNotification (MongoDB)    │
└─────────────────────────────────────────────────────────┘
```

## Data model (summary)

| Field | Purpose |
|-------|---------|
| `featureId` | `fm_*` stable id |
| `domain` | ocr, auth, seo, ship-gate, … |
| `requirements` | Normalized requirement text |
| `evaluationMatrix` | 10 universal dimensions |
| `compositeScore` | Weighted 0–100 |
| `projectName` | Reminder label (“stock-market-app”) |
| `bestInDomain` | Best composite per user+domain |
| `supersedesFeatureId` | Lineage when improving |

## MCP surface

| Tool | When |
|------|------|
| `capture_feature` | Manual refine only (adjust title/requirements or supersede) |
| `list_feature_memory` | Browse library |
| `compare_feature_memory` | A/B matrix diff |
| `publish_feature_pattern` | Opt-in community share |
| `list_community_patterns` | Browse community library |
| `plan_task` | Auto-match + `featureMemory` envelope |
| `verify_task` | Auto-capture on `loop.gate=pass` |

## Matching (Phase 2)

- Domain detection from goal (`feature-domain.ts`)
- Hybrid **35% token + 65% embedding** on requirements (`hybrid_embedding`)
- Optional `communityPatterns` in `plan_task` envelope

## Notifications (Phase 3)

- `FeatureMemoryNotification` on composite score improvement
- Email via `featureMemoryEmailNotify` (User model, default true)
- Dashboard `/dashboard/feature-memory`

## CI capture (Phase 4)

- `npm run ci:capture-feature` — `scripts/ci-capture-feature.mjs`
- `examples/github-actions/capture-feature.yml`

## Community (Phase 5)

- `visibility: community`, `communitySlug`, redacted `projectName`/`repoHint`
- Internal `GET /community/patterns`, `GET /community/stats`

## Roadmap (shipped)

| Phase | Scope |
|-------|--------|
| 1 | Private capture, match, matrix, supersede |
| 2 | Hybrid embedding similarity |
| 3 | Dashboard + email notifications |
| 4 | CI capture script + GitHub Action template |
| 5 | Opt-in community pattern library |

## DB choice

**Same MongoDB cluster** as SaaS (`FeatureMemory` collection). Split to dedicated store only when write volume or vector search demands it.

## Coupling

See `docs/PLATFORM-COUPLING.md` — row `SaaS /internal/feature-memory`.
