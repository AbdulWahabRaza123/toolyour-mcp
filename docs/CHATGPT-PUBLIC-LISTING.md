# ChatGPT public MCP listing

ToolYour's submission endpoint is a tool-only, submission-ready MCP server:

- MCP URL: `https://api.toolyour.com/mcp/chatgpt`
- OAuth resource: `https://api.toolyour.com/mcp/chatgpt`
- Protected-resource metadata: `https://api.toolyour.com/.well-known/oauth-protected-resource`
- Domain challenge: `https://api.toolyour.com/.well-known/openai-apps-challenge`

The existing `/mcp` and `/mcp/http` API-key endpoints remain unchanged. The
ChatGPT endpoint requires OAuth and omits all `job_*` and `check_submit`
control-plane tools.

## Auth0 configuration

1. Create an Auth0 API whose identifier is
   `https://api.toolyour.com/mcp/chatgpt`.
2. Add the `toolyour:mcp` permission and enable RBAC permission inclusion in
   access tokens.
3. Allow Authorization Code with PKCE (`S256`) and configure the exact ChatGPT
   redirect URI shown in the OpenAI plugin submission form.
4. Request `openid profile email toolyour:mcp`.
5. Add a post-login Auth0 Action that copies the verified user email into the
   namespaced access-token claim `https://toolyour.com/email`.
6. Configure the production environment variables documented in each
   service's `.env.example`.

Example Auth0 Action body:

```js
exports.onExecutePostLogin = async (event, api) => {
  if (event.user.email && event.user.email_verified) {
    api.accessToken.setCustomClaim(
      "https://toolyour.com/email",
      event.user.email
    );
  }
};
```

## Submission sequence

1. Deploy `toolyour-saas`, then deploy `toolyour-mcp`.
2. Connect `/mcp/chatgpt` in ChatGPT Developer Mode and complete OAuth.
3. Run Scan Tools and verify 21 tools, explicit safety annotations, OAuth
   security metadata, and output schemas.
4. Put the portal-provided challenge token in `OPENAI_APPS_CHALLENGE`, deploy,
   and verify the domain.
5. Import `chatgpt-app-submission.json`, add the logo and demo recording, and
   submit with reviewer credentials that do not require MFA.
