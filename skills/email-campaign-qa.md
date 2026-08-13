---
id: email-campaign-qa
title: Email Campaign QA
category: marketing
description: Subject line and spam-word heuristics.
operationIds: emailSubjectLineTester, emailSpamWordChecker
workflowId: email-campaign-qa-job
---

# Email Campaign QA

Pass `subject` / `preheader` / `text` from the workspace. Do not ask for a live URL.

## Inputs

| Field | Required | Notes |
|-------|----------|--------|
| `subject` | yes | Subject line to score |
| `preheader` | optional | Inbox preview text |
| `text` | optional | Alias for subject / body snippet for spam lexicon |

Example:

```json
{
  "subject": "Your spring sale starts now",
  "preheader": "Members save 20% this weekend",
  "text": "Your spring sale starts now — free shipping on orders over $50"
}
```

## Loop

1. `run_playbook("email-campaign-qa", { subject, text })`
2. Pair DNS deliverability with `dns-email-security` / SPF tools under security.
3. After copy fixes: `fix-verify-email-campaign-qa`

Heuristic spam lexicon only — not a mailbox provider spam filter.
