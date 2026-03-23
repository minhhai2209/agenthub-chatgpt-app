# AgentHub ChatGPT App

Minimal ChatGPT app for AgentHub thread workflows.

## What It Does

- Reads thread metadata
- Reads the last AI response
- Reads the thread transcript
- Reads the next human message
- Saves the next human message with upsert behavior
- Approves the next message by setting the thread back to `agent:status:todo`

The app uses ChatGPT Apps SDK / MCP, returns markdown-first tool output, and authenticates users through GitHub OAuth without a database.

## Required Environment Variables

- `AGENTHUB_REPO_SLUG`
- `AGENTHUB_THREAD_APP_PUBLIC_URL`
- `AGENTHUB_GITHUB_OAUTH_CLIENT_ID`
- `AGENTHUB_GITHUB_OAUTH_CLIENT_SECRET`
- `AGENTHUB_THREAD_APP_SEALING_SECRET`
- `PORT`

`AGENTHUB_REPO_SLUG` is required. The app only works against the exact AgentHub repo provided in that environment variable.

The server always binds `0.0.0.0` inside the container. `AGENTHUB_THREAD_APP_PUBLIC_URL` is only for OAuth/public metadata and callback URLs.

## Local Run

```bash
npm install
AGENTHUB_REPO_SLUG=minhhai2209/second-brain \
AGENTHUB_THREAD_APP_PUBLIC_URL=http://127.0.0.1:8080 \
AGENTHUB_GITHUB_OAUTH_CLIENT_ID=your-client-id \
AGENTHUB_GITHUB_OAUTH_CLIENT_SECRET=your-client-secret \
AGENTHUB_THREAD_APP_SEALING_SECRET=replace-with-32-plus-random-chars \
PORT=8080 \
npm start
```

The app listens on `PORT`. That matches Google Cloud Run, which injects the port through the `PORT` environment variable.

## Docker

```bash
docker build -t agenthub-chatgpt-app .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e AGENTHUB_REPO_SLUG=minhhai2209/second-brain \
  -e AGENTHUB_THREAD_APP_PUBLIC_URL=https://your-app.example.com \
  -e AGENTHUB_GITHUB_OAUTH_CLIENT_ID=your-client-id \
  -e AGENTHUB_GITHUB_OAUTH_CLIENT_SECRET=your-client-secret \
  -e AGENTHUB_THREAD_APP_SEALING_SECRET=replace-with-32-plus-random-chars \
  agenthub-chatgpt-app
```

The image does not set a default `PORT`. Pass it explicitly for local Docker runs, or let Cloud Run inject it at runtime.

## ChatGPT Developer Mode Setup

1. Deploy the container to a public HTTPS URL.
2. Create a GitHub OAuth App with callback URL `https://<host>/oauth/github/callback`.
3. In ChatGPT developer mode, add the connector using `https://<host>/mcp`.
4. Start a chat and use the connector.
5. On the first tool call, ChatGPT will ask the user to link GitHub.

## Available Tools

- `get_thread`
- `get_last_ai_response`
- `get_thread_transcript`
- `get_next_human_message`
- `save_next_human_message`
- `approve_next_message`
