#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import process from "node:process";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { renderErrorMarkdown, resolveRepoSlug, ThreadService } from "../lib/thread-service.mjs";
import {
  buildOAuthRequiredToolResult,
  resolveThreadAppOAuthConfig,
  ThreadAppOAuthProvider,
} from "../lib/thread-app-oauth.mjs";

const APP_NAME = "agenthub-thread-app";
const APP_VERSION = "0.2.0";
const DEFAULT_PORT = 8080;
const MCP_PATH = "/mcp";

function textResult(text) {
  return {
    content: [{ type: "text", text }],
  };
}

function toMarkdownToolResult(defaultTitle, error) {
  const title = error?.title || defaultTitle;
  const detail = error?.message || String(error);
  return textResult(renderErrorMarkdown(title, detail));
}

function registerThreadTool(server, name, descriptor, handler, authConfig) {
  const securitySchemes = [{ type: "oauth2", scopes: [authConfig.mcpScope] }];
  registerAppTool(
    server,
    name,
    {
      ...descriptor,
      securitySchemes,
      _meta: {
        securitySchemes,
        ...descriptor._meta,
      },
    },
    async (args, extra) => {
      const authInfo = extra?.authInfo || {};
      const githubAccessToken = authInfo?.githubAccessToken;
      if (!githubAccessToken) {
        return buildOAuthRequiredToolResult({
          resourceMetadataUrl: authConfig.resourceMetadataUrl,
          scope: authConfig.mcpScope,
          detail:
            authInfo?.authError ||
            "Link your GitHub account to continue. This tool needs your own GitHub authorization.",
        });
      }

      const threadService = new ThreadService({
        repoSlug: authConfig.repoSlug,
        token: githubAccessToken,
      });

      try {
        return textResult(await handler(args, extra, threadService));
      } catch (error) {
        if (Number(error?.status) === 401) {
          return buildOAuthRequiredToolResult({
            resourceMetadataUrl: authConfig.resourceMetadataUrl,
            scope: authConfig.mcpScope,
            detail: "Your GitHub authorization expired or was revoked. Reconnect to continue.",
          });
        }
        return toMarkdownToolResult(descriptor.title, error);
      }
    },
  );
}

function createThreadAppServer(authConfig) {
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION });
  const threadNumberSchema = z.number().int().positive().describe("Numeric thread number.");

  registerThreadTool(
    server,
    "get_thread",
    {
      title: "Get thread",
      description: "Read thread metadata, workspace, labels, status labels, and whether writes are currently blocked.",
      inputSchema: {
        thread_number: threadNumberSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Reading thread...",
        "openai/toolInvocation/invoked": "Thread ready",
      },
    },
    async ({ thread_number }, _extra, threadService) => threadService.getThreadMarkdown(thread_number),
    authConfig,
  );

  registerThreadTool(
    server,
    "get_last_ai_response",
    {
      title: "Get last AI response",
      description: "Read the latest AI response in the thread, excluding codex draft follow-up comments.",
      inputSchema: {
        thread_number: threadNumberSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Reading AI response...",
        "openai/toolInvocation/invoked": "AI response ready",
      },
    },
    async ({ thread_number }, _extra, threadService) => threadService.getLastAiResponseMarkdown(thread_number),
    authConfig,
  );

  registerThreadTool(
    server,
    "get_thread_transcript",
    {
      title: "Get thread transcript",
      description: "Read the full thread transcript in markdown, preserving original message bodies and classifying message kinds.",
      inputSchema: {
        thread_number: threadNumberSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Reading transcript...",
        "openai/toolInvocation/invoked": "Transcript ready",
      },
    },
    async ({ thread_number }, _extra, threadService) => threadService.getTranscriptMarkdown(thread_number),
    authConfig,
  );

  registerThreadTool(
    server,
    "get_next_human_message",
    {
      title: "Get next human message",
      description: "Read the effective next human message, preferring an explicit human follow-up over a codex draft follow-up.",
      inputSchema: {
        thread_number: threadNumberSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Reading next message...",
        "openai/toolInvocation/invoked": "Next message ready",
      },
    },
    async ({ thread_number }, _extra, threadService) => threadService.getNextHumanMessageMarkdown(thread_number),
    authConfig,
  );

  registerThreadTool(
    server,
    "save_next_human_message",
    {
      title: "Save next human message",
      description: "Create or update the next explicit human message in the thread. Draft follow-up comments are never edited, and writes are blocked while the thread is doing.",
      inputSchema: {
        thread_number: threadNumberSchema,
        body: z.string().min(1).describe("Markdown body for the next human message."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Saving next message...",
        "openai/toolInvocation/invoked": "Next message saved",
      },
    },
    async ({ thread_number, body }, _extra, threadService) =>
      threadService.upsertNextHumanMessage(thread_number, body),
    authConfig,
  );

  registerThreadTool(
    server,
    "approve_next_message",
    {
      title: "Approve next message",
      description: "Queue the thread again by applying the todo status, but only when the next message already exists and the thread is not doing.",
      inputSchema: {
        thread_number: threadNumberSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Approving next message...",
        "openai/toolInvocation/invoked": "Thread queued",
      },
    },
    async ({ thread_number }, _extra, threadService) => threadService.approveNextMessage(thread_number),
    authConfig,
  );

  return server;
}

function attachOptionalBearerAuth(verifier) {
  return async (req, _res, next) => {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader) {
      next();
      return;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      req.auth = { authError: "Invalid Authorization header format." };
      next();
      return;
    }

    try {
      req.auth = await verifier.verifyAccessToken(match[1].trim());
    } catch (error) {
      req.auth = {
        authError: error?.message || "Access token is invalid or expired.",
      };
    }

    next();
  };
}

async function main() {
  const port = Number(process.env.PORT || process.env.REPO_OPS_THREAD_APP_PORT || DEFAULT_PORT);
  const repoSlug = resolveRepoSlug();
  if (!repoSlug) {
    process.stderr.write("[thread-app] Missing repo slug. Set AGENTHUB_REPO_SLUG or REPO_OPS_REPO_SLUG.\n");
    process.exit(1);
  }

  const { config, missing } = resolveThreadAppOAuthConfig({ port });
  if (missing.length) {
    process.stderr.write(`[thread-app] Missing OAuth config: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  const oauthProvider = new ThreadAppOAuthProvider(config);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceServerUrl);
  const authConfig = {
    repoSlug,
    mcpScope: config.mcpScope,
    resourceMetadataUrl,
  };

  const app = createMcpExpressApp({
    host: config.publicBaseUrl.hostname === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
  });

  app.get("/", (_req, res) => {
    res.type("text/plain").send("AgentHub thread app");
  });

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.get("/oauth/github/callback", async (req, res) => {
    await oauthProvider.handleGitHubCallback(req, res);
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: config.publicBaseUrl,
      resourceServerUrl: config.resourceServerUrl,
      scopesSupported: [config.mcpScope],
      resourceName: "AgentHub Thread App",
      clientRegistrationOptions: {
        clientIdGeneration: false,
      },
    }),
  );

  const optionalBearerAuth = attachOptionalBearerAuth(oauthProvider);
  const transports = {};

  app.post(MCP_PATH, optionalBearerAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport = sessionId ? transports[sessionId] : null;
      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });
        transport.onclose = () => {
          const existingSessionId = transport.sessionId;
          if (existingSessionId && transports[existingSessionId]) {
            delete transports[existingSessionId];
          }
        };
        const server = createThreadAppServer(authConfig);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!transport) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      process.stderr.write(`[thread-app] MCP POST failed: ${error?.stack || error}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get(MCP_PATH, optionalBearerAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete(MCP_PATH, optionalBearerAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.listen(port, () => {
    process.stdout.write(
      `[thread-app] listening on :${port}${MCP_PATH} repo=${repoSlug} public=${config.publicBaseUrl.href}\n`,
    );
  });
}

await main();
