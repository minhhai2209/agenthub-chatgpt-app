import assert from "node:assert/strict";

import {
  StatelessClientsStore,
  ThreadAppOAuthProvider,
  validateOpenAIRedirectUri,
} from "../lib/thread-app-oauth.mjs";

const config = {
  publicBaseUrl: new URL("https://thread.example.com"),
  resourceServerUrl: new URL("https://thread.example.com/mcp"),
  githubCallbackUrl: new URL("https://thread.example.com/oauth/github/callback"),
  githubClientId: "github-client-id",
  githubClientSecret: "github-client-secret",
  sealingSecret: "0123456789abcdef0123456789abcdef",
  githubScope: "repo",
  mcpScope: "mcp:tools",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 7200,
  authCodeTtlSeconds: 300,
  githubStateTtlSeconds: 600,
  clientTtlSeconds: 86400,
};

assert.equal(validateOpenAIRedirectUri("https://chatgpt.com/connector/oauth/callback-123"), true);
assert.equal(validateOpenAIRedirectUri("https://platform.openai.com/apps-manage/oauth"), true);
assert.equal(validateOpenAIRedirectUri("https://example.com/callback"), false);

const store = new StatelessClientsStore(config);
const client = await store.registerClient({
  redirect_uris: ["https://chatgpt.com/connector/oauth/callback-123"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
});

assert.ok(client.client_id);
assert.equal(client.token_endpoint_auth_method, "none");

const roundTripClient = await store.getClient(client.client_id);
assert.equal(roundTripClient.client_id, client.client_id);
assert.deepEqual(roundTripClient.redirect_uris, client.redirect_uris);

await assert.rejects(
  async () =>
    store.registerClient({
      redirect_uris: ["https://malicious.example.com/callback"],
      token_endpoint_auth_method: "none",
    }),
  /Unsupported redirect URI/,
);

const provider = new ThreadAppOAuthProvider(config);
const tokens = provider.issueOAuthTokens({
  clientId: client.client_id,
  resource: config.resourceServerUrl.href,
  githubAccessToken: "gho_example_token",
  githubTokenExpiresAt: null,
});

assert.ok(tokens.access_token);
assert.ok(tokens.refresh_token);

const authInfo = await provider.verifyAccessToken(tokens.access_token);
assert.equal(authInfo.clientId, client.client_id);
assert.equal(authInfo.githubAccessToken, "gho_example_token");
assert.equal(authInfo.resource, config.resourceServerUrl.href);
assert.deepEqual(authInfo.scopes, ["mcp:tools"]);

const refreshedTokens = await provider.exchangeRefreshToken(
  { client_id: client.client_id },
  tokens.refresh_token,
  ["mcp:tools"],
  config.resourceServerUrl,
);

assert.ok(refreshedTokens.access_token);
assert.ok(refreshedTokens.refresh_token);

console.log("thread-app-oauth tests passed");
