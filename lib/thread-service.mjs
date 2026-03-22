import process from "node:process";

import { STATUS_LABELS } from "./issue-labels.mjs";
import { ThreadApiClient } from "./thread-api-client.mjs";
import {
  buildWriteGuard,
  collectLabelNames,
  collectStatusLabels,
  findLatestAiResponse,
  renderAiResponseMarkdown,
  renderNextHumanMessageMarkdown,
  renderThreadMarkdown,
  renderTranscriptMarkdown,
  resolveNextHumanMessage,
  resolveUpsertDecision,
} from "./thread-api-utils.mjs";

export class ThreadServiceError extends Error {
  constructor(status, title, message) {
    super(message);
    this.name = "ThreadServiceError";
    this.status = status;
    this.title = title;
  }
}

export function renderErrorMarkdown(title, detail) {
  return [
    `# ${title}`,
    "",
    detail || "_No detail provided._",
  ].join("\n");
}

export function resolveRepoSlug({ env = process.env } = {}) {
  if (env.AGENTHUB_REPO_SLUG) return env.AGENTHUB_REPO_SLUG;
  if (env.REPO_OPS_REPO_SLUG) return env.REPO_OPS_REPO_SLUG;
  return null;
}

function renderWriteReceipt({ heading, action, threadNumber, body }) {
  return [
    heading,
    `- thread: ${threadNumber}`,
    `- action: ${action}`,
    "",
    "### Body",
    "",
    body.replace(/\s+$/, "") || "(empty)",
  ].join("\n");
}

export class ThreadService {
  constructor({ repoSlug = null, token = "", client = null } = {}) {
    if (client) {
      this.client = client;
      return;
    }
    this.client = new ThreadApiClient({ repoSlug, token });
  }

  async loadThreadContext(threadNumber) {
    const [thread, comments] = await Promise.all([
      this.client.fetchThread(threadNumber),
      this.client.fetchComments(threadNumber),
    ]);
    return { thread, comments };
  }

  async getThreadMarkdown(threadNumber) {
    const { thread, comments } = await this.loadThreadContext(threadNumber);
    return renderThreadMarkdown({ issue: thread, comments });
  }

  async getLastAiResponseMarkdown(threadNumber) {
    const { thread, comments } = await this.loadThreadContext(threadNumber);
    const aiResponse = findLatestAiResponse(comments);
    if (!aiResponse) {
      throw new ThreadServiceError(404, "Last AI Response", "No AI response was found for this thread.");
    }
    return renderAiResponseMarkdown({ issue: thread, aiResponse });
  }

  async getTranscriptMarkdown(threadNumber) {
    const { thread, comments } = await this.loadThreadContext(threadNumber);
    return renderTranscriptMarkdown({ issue: thread, comments });
  }

  async getNextHumanMessageMarkdown(threadNumber) {
    const [viewerLogin, { thread, comments }] = await Promise.all([
      this.client.fetchViewerLogin(),
      this.loadThreadContext(threadNumber),
    ]);
    const nextMessage = resolveNextHumanMessage(comments);
    if (!nextMessage.entry) {
      throw new ThreadServiceError(404, "Next Human Message", "No next human message is available for this thread.");
    }
    return renderNextHumanMessageMarkdown({ issue: thread, nextMessage, viewerLogin });
  }

  async upsertNextHumanMessage(threadNumber, messageBody) {
    if (!String(messageBody || "").trim()) {
      throw new ThreadServiceError(400, "Next Human Message", "Request body is empty.");
    }
    const [viewerLogin, { thread, comments }] = await Promise.all([
      this.client.fetchViewerLogin(),
      this.loadThreadContext(threadNumber),
    ]);
    const labelNames = collectLabelNames(thread);
    const writeGuard = buildWriteGuard(labelNames);
    if (!writeGuard.allowed) {
      throw new ThreadServiceError(409, "Next Human Message", `Write blocked: ${writeGuard.reason}.`);
    }
    const decision = resolveUpsertDecision({ comments, viewerLogin });
    if (decision.action === "conflict") {
      const author = decision.target?.user?.login || "unknown";
      throw new ThreadServiceError(
        409,
        "Next Human Message",
        `Write blocked: the latest human message after the last AI response belongs to @${author}.`,
      );
    }
    if (decision.action === "edit") {
      await this.client.updateComment(decision.target.id, messageBody);
      return renderWriteReceipt({
        heading: "# Next Human Message",
        action: "edited",
        threadNumber,
        body: messageBody,
      });
    }
    await this.client.createComment(threadNumber, messageBody);
    return renderWriteReceipt({
      heading: "# Next Human Message",
      action: "created",
      threadNumber,
      body: messageBody,
    });
  }

  async approveNextMessage(threadNumber) {
    const { thread, comments } = await this.loadThreadContext(threadNumber);
    const labelNames = collectLabelNames(thread);
    const writeGuard = buildWriteGuard(labelNames);
    if (!writeGuard.allowed) {
      throw new ThreadServiceError(409, "Approve Next Message", `Write blocked: ${writeGuard.reason}.`);
    }
    const nextMessage = resolveNextHumanMessage(comments);
    if (!nextMessage.entry) {
      throw new ThreadServiceError(
        409,
        "Approve Next Message",
        "Write blocked: the next message must already exist as a codex draft-follow-up or an explicit human comment.",
      );
    }
    await this.replaceStatusesWithTodo(threadNumber, labelNames);
    return [
      "# Approve Next Message",
      `- thread: ${threadNumber}`,
      `- source: ${nextMessage.source}`,
      `- action: status set to ${STATUS_LABELS.todo}`,
    ].join("\n");
  }

  async replaceStatusesWithTodo(threadNumber, labelNames) {
    const statusLabels = collectStatusLabels(labelNames);
    for (const label of statusLabels) {
      await this.client.removeLabel(threadNumber, label);
    }
    await this.client.addLabels(threadNumber, [STATUS_LABELS.todo]);
  }
}
