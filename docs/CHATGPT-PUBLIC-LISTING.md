# ChatGPT public MCP listing

ToolYour's submission endpoint is a tool-only, submission-ready MCP server:

- MCP URL: `https://api.toolyour.com/mcp/chatgpt`
- OAuth resource: `https://api.toolyour.com/mcp/chatgpt`
- Protected-resource metadata: `https://api.toolyour.com/.well-known/oauth-protected-resource`
- Domain challenge: `https://api.toolyour.com/.well-known/openai-apps-challenge`

The `/mcp` and `/mcp/http` API-key endpoints use stateless Streamable HTTP, so
clients can reconnect without process-local session affinity. `GET /mcp`
continues to serve the legacy SSE transport. The ChatGPT endpoint remains a
separate OAuth-protected transport and omits all `job_*` and `check_submit`
control-plane tools.

## Auth0 configuration

1. Create an Auth0 API whose identifier is
   `https://api.toolyour.com/mcp/chatgpt`.
2. Add the `toolyour:mcp` permission and enable RBAC permission inclusion in
   access tokens.
3. Allow Authorization Code with PKCE (`S256`). Copy the exact production
   redirect URI shown for the current ChatGPT connection in its management UI
   into Auth0's Allowed Callback URLs. The production Auth0 discovery metadata
   checked on 2026-10-20 does not advertise
   `authorization_response_iss_parameter_supported: true`, so ChatGPT should
   use its callback-ID-specific URI (`https://chatgpt.com/connector/oauth/{callback_id}`).
   Use the actual URI shown by ChatGPT, not the literal placeholder. Use the
   stable `https://chatgpt.com/connector_platform_oauth_redirect` only if Auth0
   later advertises issuer identification and returns the exact `iss` value in
   every successful and error authorization response.
4. Request `openid profile email toolyour:mcp`.
5. Add a post-login Auth0 Action that copies the verified user email into the
   namespaced access-token claim `https://toolyour.com/email`.
6. Configure the production environment variables documented in each
   service's `.env.example`.

## Diagnosing `state not found`

The production OAuth resource metadata, path-scoped metadata, Auth0 issuer
discovery, and unauthenticated bearer challenge passed read-only checks on
2026-10-20. The MCP server does not implement ChatGPT's OAuth authorization
callback or own its `state`; Auth0 and ChatGPT run that browser authorization
transaction. This confirms discovery, not successful sign-in.

Check the exact `redirect_uri` sent in the authorization request against the
callback URL configured in Auth0. With the current Auth0 metadata, confirm that
the callback-ID-specific URL for this ChatGPT connection is allowlisted; do
not assume that a previously used stable callback is still selected. Also
confirm the browser returns to the same Auth0 transaction, the authorization
response preserves `state`, the returned `iss` behavior matches the issuer
metadata, and the `resource` parameter is preserved through authorization and
token exchange. OpenAI's [current MCP authentication guide](https://developers.openai.com/plugins/build/auth)
documents the issuer and redirect-URI requirements.

Do not log raw `state`, authorization codes, access tokens, cookies, or PKCE
verifiers. A useful sanitized trace records the endpoint/status, selected
redirect URI, issuer-match result, whether `state` was present and matched,
resource, requested scopes, and whether PKCE used `S256`. Keep the OAuth error
marked unresolved until a complete ChatGPT authorization and MCP request pass.

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
