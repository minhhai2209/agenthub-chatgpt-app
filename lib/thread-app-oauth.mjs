import crypto from "node:crypto";
import process from "node:process";

import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const OPENAI_CONNECTOR_REDIRECT_PREFIX = "https://chatgpt.com/connector/oauth/";
const OPENAI_CONNECTOR_REDIRECT_LEGACY = "https://chatgpt.com/connector_platform_oauth_redirect";
const OPENAI_REVIEW_REDIRECT = "https://platform.openai.com/apps-manage/oauth";

const DEFAULT_AUTH_SCOPE = "mcp:tools";
const DEFAULT_GITHUB_SCOPE = "repo";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_AUTH_CODE_TTL_SECONDS = 5 * 60;
const DEFAULT_GITHUB_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function asPositiveInteger(value, fallbackValue) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallbackValue;
}

function createCipherKey(secret, purpose) {
  return crypto.createHash("sha256").update(`${purpose}:${secret}`).digest();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function validateOpenAIRedirectUri(redirectUri) {
  const value = String(redirectUri || "");
  return (
    value.startsWith(OPENAI_CONNECTOR_REDIRECT_PREFIX) ||
    value === OPENAI_CONNECTOR_REDIRECT_LEGACY ||
    value === OPENAI_REVIEW_REDIRECT
  );
}

export function sealThreadAppPayload(payload, { purpose, secret, ttlSeconds }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", createCipherKey(secret, purpose), iv);
  const plaintext = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: nowSeconds(),
      exp: nowSeconds() + asPositiveInteger(ttlSeconds, 60),
    }),
    "utf8",
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}.${base64UrlEncode(tag)}`;
}

export function unsealThreadAppPayload(token, { purpose, secret, expectedKind }) {
  const [version, ivPart, ciphertextPart, tagPart] = String(token || "").split(".");
  if (version !== "v1" || !ivPart || !ciphertextPart || !tagPart) {
    throw new InvalidGrantError("Malformed token.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      createCipherKey(secret, purpose),
      base64UrlDecode(ivPart),
    );
    decipher.setAuthTag(base64UrlDecode(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(ciphertextPart)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext);
    if (expectedKind && payload?.kind !== expectedKind) {
      throw new InvalidGrantError("Token kind mismatch.");
    }
    if (!payload?.exp || payload.exp < nowSeconds()) {
      throw new InvalidGrantError("Token has expired.");
    }
    return payload;
  } catch (error) {
    if (error instanceof InvalidGrantError) throw error;
    throw new InvalidGrantError("Token could not be verified.");
  }
}

export function buildWwwAuthenticateChallenge({
  resourceMetadataUrl,
  scope = DEFAULT_AUTH_SCOPE,
  error = "invalid_token",
  description = "Authentication required.",
}) {
  const safeDescription = String(description || "").replace(/"/g, "'");
  return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}", error="${error}", error_description="${safeDescription}"`;
}

export function buildOAuthRequiredToolResult({
  resourceMetadataUrl,
  scope = DEFAULT_AUTH_SCOPE,
  heading = "Authentication Required",
  detail = "Link your GitHub account to continue.",
  error = "invalid_token",
}) {
  return {
    content: [
      {
        type: "text",
        text: [`# ${heading}`, "", detail].join("\n"),
      },
    ],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        buildWwwAuthenticateChallenge({
          resourceMetadataUrl,
          scope,
          error,
          description: detail,
        }),
      ],
    },
  };
}

function redirectWithOAuthError(res, redirectUri, error, description, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) {
    url.searchParams.set("error_description", description);
  }
  if (state) {
    url.searchParams.set("state", state);
  }
  res.redirect(url.toString());
}

function parseOptionalResource(resource) {
  if (!resource) return null;
  return typeof resource === "string" ? resource : resource.href;
}

function validateResourceMatch(expectedResource, receivedResource) {
  const expected = parseOptionalResource(expectedResource);
  const received = parseOptionalResource(receivedResource);
  if (expected && received && expected !== received) {
    throw new InvalidGrantError("Resource mismatch.");
  }
  return expected || received || null;
}

function githubTokenExpirySeconds(tokenResponse) {
  const expiresIn = Number(tokenResponse?.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return Math.max(60, Math.floor(expiresIn) - 60);
}

async function exchangeGitHubAuthorizationCode({
  githubClientId,
  githubClientSecret,
  code,
  redirectUri,
}) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: githubClientId,
      client_secret: githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) {
    const detail = body?.error_description || body?.error || `GitHub token exchange failed with ${response.status}.`;
    throw new InvalidGrantError(detail);
  }
  return body;
}

export function resolveThreadAppOAuthConfig({ env = process.env, port = 8080 } = {}) {
  const publicUrl = env.AGENTHUB_THREAD_APP_PUBLIC_URL || `http://127.0.0.1:${port}`;
  const config = {
    publicBaseUrl: new URL(publicUrl),
    resourceServerUrl: new URL("/mcp", publicUrl),
    githubCallbackUrl: new URL("/oauth/github/callback", publicUrl),
    githubClientId: env.AGENTHUB_GITHUB_OAUTH_CLIENT_ID || "",
    githubClientSecret: env.AGENTHUB_GITHUB_OAUTH_CLIENT_SECRET || "",
    sealingSecret: env.AGENTHUB_THREAD_APP_SEALING_SECRET || "",
    githubScope: env.AGENTHUB_GITHUB_OAUTH_SCOPE || DEFAULT_GITHUB_SCOPE,
    mcpScope: env.AGENTHUB_THREAD_APP_MCP_SCOPE || DEFAULT_AUTH_SCOPE,
    accessTokenTtlSeconds: asPositiveInteger(
      env.AGENTHUB_THREAD_APP_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    ),
    refreshTokenTtlSeconds: asPositiveInteger(
      env.AGENTHUB_THREAD_APP_REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    ),
    authCodeTtlSeconds: asPositiveInteger(
      env.AGENTHUB_THREAD_APP_AUTH_CODE_TTL_SECONDS,
      DEFAULT_AUTH_CODE_TTL_SECONDS,
    ),
    githubStateTtlSeconds: asPositiveInteger(
      env.AGENTHUB_THREAD_APP_GITHUB_STATE_TTL_SECONDS,
      DEFAULT_GITHUB_STATE_TTL_SECONDS,
    ),
    clientTtlSeconds: asPositiveInteger(
      env.AGENTHUB_THREAD_APP_CLIENT_TTL_SECONDS,
      DEFAULT_CLIENT_TTL_SECONDS,
    ),
  };
  const missing = [];
  if (!env.AGENTHUB_THREAD_APP_PUBLIC_URL) missing.push("AGENTHUB_THREAD_APP_PUBLIC_URL");
  if (!config.githubClientId) missing.push("AGENTHUB_GITHUB_OAUTH_CLIENT_ID");
  if (!config.githubClientSecret) missing.push("AGENTHUB_GITHUB_OAUTH_CLIENT_SECRET");
  if (!config.sealingSecret) missing.push("AGENTHUB_THREAD_APP_SEALING_SECRET");
  if (config.sealingSecret && config.sealingSecret.length < 32) {
    missing.push("AGENTHUB_THREAD_APP_SEALING_SECRET must be at least 32 characters");
  }
  return { config, missing };
}

export class StatelessClientsStore {
  constructor(config) {
    this.config = config;
  }

  async registerClient(clientMetadata) {
    const redirectUris = Array.isArray(clientMetadata?.redirect_uris) ? clientMetadata.redirect_uris : [];
    if (!redirectUris.length) {
      throw new InvalidClientMetadataError("At least one redirect URI is required.");
    }
    for (const redirectUri of redirectUris) {
      if (!validateOpenAIRedirectUri(redirectUri)) {
        throw new InvalidClientMetadataError(`Unsupported redirect URI: ${redirectUri}`);
      }
    }
    const now = nowSeconds();
    const clientInfo = {
      ...clientMetadata,
      token_endpoint_auth_method: "none",
      client_id_issued_at: now,
    };
    const clientId = sealThreadAppPayload(
      {
        kind: "client",
        client: clientInfo,
      },
      {
        purpose: "client",
        secret: this.config.sealingSecret,
        ttlSeconds: this.config.clientTtlSeconds,
      },
    );
    return {
      ...clientInfo,
      client_id: clientId,
    };
  }

  async getClient(clientId) {
    try {
      const payload = unsealThreadAppPayload(clientId, {
        purpose: "client",
        secret: this.config.sealingSecret,
        expectedKind: "client",
      });
      return {
        ...payload.client,
        client_id: clientId,
      };
    } catch {
      return undefined;
    }
  }
}

export class ThreadAppOAuthProvider {
  constructor(config) {
    this.config = config;
    this.clientsStore = new StatelessClientsStore(config);
  }

  async authorize(client, params, res) {
    const state = sealThreadAppPayload(
      {
        kind: "github_state",
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state || null,
        resource: parseOptionalResource(params.resource),
      },
      {
        purpose: "github_state",
        secret: this.config.sealingSecret,
        ttlSeconds: this.config.githubStateTtlSeconds,
      },
    );

    const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", this.config.githubClientId);
    authorizeUrl.searchParams.set("redirect_uri", this.config.githubCallbackUrl.href);
    authorizeUrl.searchParams.set("scope", this.config.githubScope);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("allow_signup", "false");
    res.redirect(authorizeUrl.toString());
  }

  async handleGitHubCallback(req, res) {
    const githubState = String(req.query.state || "");
    let statePayload;
    try {
      statePayload = unsealThreadAppPayload(githubState, {
        purpose: "github_state",
        secret: this.config.sealingSecret,
        expectedKind: "github_state",
      });
    } catch (error) {
      res.status(400).send(error?.message || "Invalid OAuth state.");
      return;
    }

    if (req.query.error) {
      redirectWithOAuthError(
        res,
        statePayload.redirectUri,
        String(req.query.error),
        String(req.query.error_description || "GitHub authorization was not completed."),
        statePayload.state,
      );
      return;
    }

    const githubCode = String(req.query.code || "");
    if (!githubCode) {
      redirectWithOAuthError(
        res,
        statePayload.redirectUri,
        "access_denied",
        "GitHub did not return an authorization code.",
        statePayload.state,
      );
      return;
    }

    try {
      const tokenResponse = await exchangeGitHubAuthorizationCode({
        githubClientId: this.config.githubClientId,
        githubClientSecret: this.config.githubClientSecret,
        code: githubCode,
        redirectUri: this.config.githubCallbackUrl.href,
      });

      const authCode = sealThreadAppPayload(
        {
          kind: "authorization_code",
          clientId: statePayload.clientId,
          redirectUri: statePayload.redirectUri,
          codeChallenge: statePayload.codeChallenge,
          state: statePayload.state,
          resource: statePayload.resource,
          githubAccessToken: tokenResponse.access_token,
          githubScope: tokenResponse.scope || "",
          githubTokenType: tokenResponse.token_type || "bearer",
          githubTokenExpiresAt: githubTokenExpirySeconds(tokenResponse)
            ? nowSeconds() + githubTokenExpirySeconds(tokenResponse)
            : null,
        },
        {
          purpose: "authorization_code",
          secret: this.config.sealingSecret,
          ttlSeconds: Math.min(
            this.config.authCodeTtlSeconds,
            githubTokenExpirySeconds(tokenResponse) || this.config.authCodeTtlSeconds,
          ),
        },
      );

      const redirectUrl = new URL(statePayload.redirectUri);
      redirectUrl.searchParams.set("code", authCode);
      if (statePayload.state) {
        redirectUrl.searchParams.set("state", statePayload.state);
      }
      res.redirect(redirectUrl.toString());
    } catch (error) {
      redirectWithOAuthError(
        res,
        statePayload.redirectUri,
        "access_denied",
        error?.message || "GitHub authorization failed.",
        statePayload.state,
      );
    }
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const payload = unsealThreadAppPayload(authorizationCode, {
      purpose: "authorization_code",
      secret: this.config.sealingSecret,
      expectedKind: "authorization_code",
    });
    if (payload.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code was not issued to this client.");
    }
    return payload.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const payload = unsealThreadAppPayload(authorizationCode, {
      purpose: "authorization_code",
      secret: this.config.sealingSecret,
      expectedKind: "authorization_code",
    });
    if (payload.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code was not issued to this client.");
    }
    if (redirectUri && redirectUri !== payload.redirectUri) {
      throw new InvalidGrantError("redirect_uri mismatch.");
    }
    const resourceValue = validateResourceMatch(payload.resource, resource);
    return this.issueOAuthTokens({
      clientId: client.client_id,
      resource: resourceValue,
      githubAccessToken: payload.githubAccessToken,
      githubTokenExpiresAt: payload.githubTokenExpiresAt,
    });
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const payload = unsealThreadAppPayload(refreshToken, {
      purpose: "refresh_token",
      secret: this.config.sealingSecret,
      expectedKind: "refresh_token",
    });
    if (payload.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token was not issued to this client.");
    }
    if (Array.isArray(scopes) && scopes.length && scopes.join(" ") !== this.config.mcpScope) {
      throw new InvalidGrantError("Scope escalation is not allowed.");
    }
    const resourceValue = validateResourceMatch(payload.resource, resource);
    return this.issueOAuthTokens({
      clientId: client.client_id,
      resource: resourceValue,
      githubAccessToken: payload.githubAccessToken,
      githubTokenExpiresAt: payload.githubTokenExpiresAt,
    });
  }

  issueOAuthTokens({ clientId, resource, githubAccessToken, githubTokenExpiresAt }) {
    const now = nowSeconds();
    const githubRemainingTtl = githubTokenExpiresAt ? Math.max(60, githubTokenExpiresAt - now) : null;
    const accessTtl = Math.min(
      this.config.accessTokenTtlSeconds,
      githubRemainingTtl || this.config.accessTokenTtlSeconds,
    );
    const refreshTtl = Math.min(
      this.config.refreshTokenTtlSeconds,
      githubRemainingTtl || this.config.refreshTokenTtlSeconds,
    );

    const accessToken = sealThreadAppPayload(
      {
        kind: "access_token",
        clientId,
        scopes: [this.config.mcpScope],
        resource,
        githubAccessToken,
      },
      {
        purpose: "access_token",
        secret: this.config.sealingSecret,
        ttlSeconds: accessTtl,
      },
    );

    const refreshToken = sealThreadAppPayload(
      {
        kind: "refresh_token",
        clientId,
        scopes: [this.config.mcpScope],
        resource,
        githubAccessToken,
        githubTokenExpiresAt: githubTokenExpiresAt || null,
      },
      {
        purpose: "refresh_token",
        secret: this.config.sealingSecret,
        ttlSeconds: refreshTtl,
      },
    );

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: accessTtl,
      refresh_token: refreshToken,
      scope: this.config.mcpScope,
    };
  }

  async verifyAccessToken(token) {
    const payload = unsealThreadAppPayload(token, {
      purpose: "access_token",
      secret: this.config.sealingSecret,
      expectedKind: "access_token",
    });
    const resource = validateResourceMatch(this.config.resourceServerUrl, payload.resource);
    return {
      token,
      clientId: payload.clientId,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [this.config.mcpScope],
      expiresAt: payload.exp,
      resource,
      githubAccessToken: payload.githubAccessToken,
    };
  }
}
