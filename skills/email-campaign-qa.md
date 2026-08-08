---
id: email-campaign-qa
title: Email Campaign QA
category: marketing
description: Subject line and spam-word heuristics.
operationIds: emailSubjectLineTester, emailSpamWordChecker
workflowId: email-campaign-qa-job
---

# Email Campaign QA

1. `run_playbook("email-campaign-qa", { subject, text })`
2. Pair DNS deliverability with `dns-email-security` / SPF tools under security.
3. After copy fixes: `fix-verify-email-campaign-qa`
