import { createGitHubAppTokenProvider } from "./app-auth";
import { collectPullRequestEvidence, parseGitHubPullRequest } from "./pr-evidence";
import { decidePullRequestReadiness, workRecordUpdateFromReadiness } from "./pr-readiness";
import { saveWorkRecord } from "../work-record/store-saas";
import { loadRepositoryPolicy } from "../work-record/repository-policy-store";

/** Read-only GitHub collection followed by internal persistence. No public MCP tool calls this yet. */
export async function capturePullRequestReadiness(opts: {
  pullRequestUrl: string;
  workId: string;
  ownerKey: string;
  objective: string;
  githubAppId: string;
  githubAppPrivateKey: string;
}): Promise<ReturnType<typeof decidePullRequestReadiness>> {
  const ref = parseGitHubPullRequest(opts.pullRequestUrl);
  const provider = createGitHubAppTokenProvider({ appId: opts.githubAppId, privateKey: opts.githubAppPrivateKey });
  const token = await provider.getInstallationToken(ref);
  const evidence = await collectPullRequestEvidence({ pullRequestUrl: opts.pullRequestUrl, token });
  const policy = await loadRepositoryPolicy(opts.ownerKey, `${ref.owner}/${ref.repo}`);
  const readiness = decidePullRequestReadiness(evidence, policy);
  await saveWorkRecord(workRecordUpdateFromReadiness({
    workId: opts.workId,
    ownerKey: opts.ownerKey,
    objective: opts.objective,
    readiness,
  }));
  return readiness;
}
