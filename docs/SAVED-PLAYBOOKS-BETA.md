# Saved Playbooks beta

## Product meaning

ToolYour helps a person teach repeated work once and use it from any compatible AI host. A
Saved Playbook is not an autonomous coding agent and is not a shell runner. It is a named,
owner-scoped reference to one registered ToolYour skill or workflow plus safe input defaults and
acceptance criteria.

This makes the promise concrete: an agency can save a **Website Launch Check**, a team can save a
**Developer Ship Check**, and each connected agent can request the same evidence-producing
ToolYour workflow without needing to remember its individual tools.

## V1 boundary

| Included | Intentionally excluded |
| --- | --- |
| Existing ToolYour skills and workflows | Arbitrary shell commands or pasted code execution |
| Versioned definitions | Silent replacement of an earlier definition |
| Owner-scoped storage and run receipts | Cross-account sharing |
| Explicit active/draft/archive state | Automatic production changes |
| Inputs merged with saved defaults | Control of Cursor, Claude Code, or Codex sessions |

`run_saved_playbook` first creates a durable run receipt, then calls the existing skill or
workflow engine. The completed receipt stores the actual result and any reported gate. A partial
or failed run is never represented as a pass.

## Private-beta rollout

1. Deploy the SaaS schema and internal routes.
2. Set `PLAYBOOKS_BETA=true` only on the default/private MCP profile.
3. Seed a few real playbooks with a small pilot group. Start with website launch, weekly growth,
   and developer ship checks.
4. Measure completion, repeat use, editing frequency, and failure reasons.
5. Only after validation and public-review constraints permit it, decide whether to publish a
   focused public tool surface and documentation.

The current ChatGPT public endpoint remains unchanged. Do not promote this beta as a general
public capability until it is enabled, tested, and reviewed for that endpoint.
