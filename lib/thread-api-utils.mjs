import {
  LEGACY_CODEX_RESPONSE_MARKER,
  NO_MILESTONE_LABEL,
  RESPONSE_MARKER,
  STATUS_LABEL_PREFIX,
  normalizeStatusLabel,
} from "./issue-labels.mjs";
import { classifyComment, isAutomationComment, isDraftFollowUpComment } from "./issue-comment-utils.mjs";

const LEGACY_CODEX_RESPONSE_MARKER_V0 = "<!-- codex:response -->";
const LEGACY_STATUS_LABEL_PREFIX = "agent-status:";

export function collectLabelNames(issueOrLabels) {
  const source = Array.isArray(issueOrLabels) ? issueOrLabels : issueOrLabels?.labels;
  if (!Array.isArray(source)) return [];
  return source
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter(Boolean);
}

export function collectStatusLabels(labelNames = []) {
  return labelNames.filter(
    (name) => typeof name === "string" && (name.startsWith(STATUS_LABEL_PREFIX) || name.startsWith(LEGACY_STATUS_LABEL_PREFIX)),
  );
}

export function resolveWorkspaceName(issue = {}, labelNames = collectLabelNames(issue)) {
  const title = issue?.milestone?.title;
  if (title) return title;
  if (labelNames.includes(NO_MILESTONE_LABEL)) return "none";
  return "none";
}

export function buildWriteGuard(labelNames = []) {
  const blocked = labelNames.some((label) => normalizeStatusLabel(label)?.status === "doing");
  return {
    allowed: !blocked,
    reason: blocked ? "thread is doing" : "allowed",
  };
}

export function extractAutomationResponse(body) {
  if (!body) return "";
  const lines = String(body).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (
      trimmed === RESPONSE_MARKER ||
      trimmed === LEGACY_CODEX_RESPONSE_MARKER ||
      trimmed === LEGACY_CODEX_RESPONSE_MARKER_V0
    ) {
      const response = lines.slice(i + 1).join("\n").trim();
      return response === "(no assistant reply)" ? "" : response;
    }
  }
  const summaryIndex = lines.findIndex((line) => line.trim() === "### Summary");
  if (summaryIndex === -1) return "";
  const summary = lines.slice(summaryIndex + 1).join("\n").trim();
  return summary === "(no assistant reply)" ? "" : summary;
}

export function extractMetadata(body = "") {
  const out = {};
  const lines = String(body).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^@([a-z0-9_]+):\s*(.*)$/i);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (out[key] === undefined) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(out[key])) {
      out[key].push(value);
      continue;
    }
    out[key] = [out[key], value];
  }
  return out;
}

export function findLatestAiResponse(comments = []) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    const body = String(comment?.body || "");
    if (!isAutomationComment(body)) continue;
    const response = extractAutomationResponse(body);
    if (!response) continue;
    return {
      index,
      comment,
      response,
      metadata: extractMetadata(body),
      classification: classifyComment(body),
    };
  }
  return null;
}

export function findLatestDraftFollowUp(comments = [], { afterIndex = -1 } = {}) {
  for (let index = comments.length - 1; index > afterIndex; index -= 1) {
    const comment = comments[index];
    const body = String(comment?.body || "");
    if (!isDraftFollowUpComment(body)) continue;
    return {
      index,
      comment,
      classification: classifyComment(body),
    };
  }
  return null;
}

export function isExplicitHumanComment(body = "") {
  const text = String(body || "");
  if (!text.trim()) return false;
  if (isDraftFollowUpComment(text)) return false;
  if (isAutomationComment(text)) return false;
  return true;
}

export function findLatestExplicitHumanComment(comments = [], { afterIndex = -1 } = {}) {
  for (let index = comments.length - 1; index > afterIndex; index -= 1) {
    const comment = comments[index];
    const body = String(comment?.body || "");
    if (!isExplicitHumanComment(body)) continue;
    return {
      index,
      comment,
      classification: classifyComment(body),
    };
  }
  return null;
}

export function resolveNextHumanMessage(comments = []) {
  const aiResponse = findLatestAiResponse(comments);
  if (!aiResponse) {
    return {
      source: "none",
      aiResponse: null,
      entry: null,
    };
  }
  const human = findLatestExplicitHumanComment(comments, { afterIndex: aiResponse.index });
  if (human) {
    return {
      source: "human",
      aiResponse,
      entry: human,
    };
  }
  const draft = findLatestDraftFollowUp(comments, { afterIndex: aiResponse.index });
  if (draft) {
    return {
      source: "codex-draft-follow-up",
      aiResponse,
      entry: draft,
    };
  }
  return {
    source: "none",
    aiResponse,
    entry: null,
  };
}

export function resolveUpsertDecision({ comments = [], viewerLogin = "" }) {
  const aiResponse = findLatestAiResponse(comments);
  if (!aiResponse) {
    return {
      action: "create",
      reason: "no ai response yet",
      aiResponse: null,
      target: null,
    };
  }
  const latestHuman = findLatestExplicitHumanComment(comments, { afterIndex: aiResponse.index });
  if (!latestHuman) {
    return {
      action: "create",
      reason: "no explicit human message after last ai response",
      aiResponse,
      target: null,
    };
  }
  const author = latestHuman.comment?.user?.login || "";
  if (author === viewerLogin) {
    return {
      action: "edit",
      reason: "latest explicit human message belongs to viewer",
      aiResponse,
      target: latestHuman.comment,
    };
  }
  return {
    action: "conflict",
    reason: `latest explicit human message belongs to @${author || "unknown"}`,
    aiResponse,
    target: latestHuman.comment,
  };
}

export function renderThreadMarkdown({ issue = {}, comments = [] }) {
  const labelNames = collectLabelNames(issue);
  const statusLabels = collectStatusLabels(labelNames);
  const writeGuard = buildWriteGuard(labelNames);
  return [
    "# Thread",
    `- thread: ${issue?.number ?? "unknown"}`,
    `- title: ${issue?.title || "(untitled)"}`,
    `- workspace: ${resolveWorkspaceName(issue, labelNames)}`,
    `- state: ${issue?.state || "unknown"}`,
    `- created_at: ${issue?.created_at || "unknown"}`,
    `- updated_at: ${issue?.updated_at || "unknown"}`,
    `- comments: ${Array.isArray(comments) ? comments.length : Number(issue?.comments) || 0}`,
    `- write_guard: ${writeGuard.allowed ? "allowed" : `blocked (${writeGuard.reason})`}`,
    `- status_labels: ${statusLabels.length ? statusLabels.join(", ") : "(none)"}`,
    `- labels: ${labelNames.length ? labelNames.join(", ") : "(none)"}`,
  ].join("\n");
}

function renderMessageBlock({ heading, source, entry, editable = false }) {
  if (!entry?.comment) {
    return [heading, "- source: none", "- editable: no", "", "_No message found._"].join("\n");
  }
  const comment = entry.comment;
  const author = comment?.user?.login || "unknown";
  const createdAt = comment?.created_at || comment?.updated_at || "unknown";
  const body = String(comment?.body || "").replace(/\s+$/, "");
  return [
    heading,
    `- source: ${source}`,
    `- editable: ${editable ? "yes" : "no"}`,
    `- message_id: ${comment?.id ?? "unknown"}`,
    `- author: ${author}`,
    `- at: ${createdAt}`,
    "",
    "### Body",
    "",
    body || "(empty)",
  ].join("\n");
}

export function renderAiResponseMarkdown({ issue = {}, aiResponse = null }) {
  if (!aiResponse?.comment) {
    return [
      "# Last AI Response",
      `- thread: ${issue?.number ?? "unknown"}`,
      `- workspace: ${resolveWorkspaceName(issue)}`,
      "",
      "_No AI response found._",
    ].join("\n");
  }
  return renderMessageBlock({
    heading: "# Last AI Response",
    source: "ai-response",
    entry: aiResponse,
    editable: false,
  });
}

export function renderNextHumanMessageMarkdown({ issue = {}, nextMessage = null, viewerLogin = "" }) {
  if (!nextMessage?.entry?.comment) {
    return [
      "# Next Human Message",
      `- thread: ${issue?.number ?? "unknown"}`,
      `- workspace: ${resolveWorkspaceName(issue)}`,
      "- source: none",
      "- editable: no",
      "",
      "_No next human message found._",
    ].join("\n");
  }
  const editable =
    nextMessage.source === "human" && String(nextMessage.entry.comment?.user?.login || "") === String(viewerLogin || "");
  return renderMessageBlock({
    heading: "# Next Human Message",
    source: nextMessage.source,
    entry: nextMessage.entry,
    editable,
  });
}

function classifyTranscriptMessage(body = "") {
  if (isDraftFollowUpComment(body)) {
    return { role: "Human", kind: "codex-draft-follow-up" };
  }
  if (isAutomationComment(body)) {
    const response = extractAutomationResponse(body);
    return {
      role: "AI",
      kind: response ? "ai-response" : "automation",
    };
  }
  return { role: "Human", kind: "human" };
}

export function renderTranscriptMarkdown({ issue = {}, comments = [] }) {
  const lines = ["# Transcript"];
  let messageNumber = 0;
  const issueBody = String(issue?.body || "").replace(/\s+$/, "");
  if (issueBody.trim()) {
    lines.push("", `## Message ${messageNumber}`);
    lines.push("- role: Human");
    lines.push("- kind: thread-start");
    lines.push(`- author: ${issue?.user?.login || "unknown"}`);
    lines.push(`- at: ${issue?.created_at || issue?.updated_at || "unknown"}`);
    lines.push("", "### Body", "", issueBody);
    messageNumber += 1;
  }
  for (const comment of comments) {
    const body = String(comment?.body || "").replace(/\s+$/, "");
    if (!body.trim()) continue;
    const meta = classifyTranscriptMessage(body);
    lines.push("", `## Message ${messageNumber}`);
    lines.push(`- role: ${meta.role}`);
    lines.push(`- kind: ${meta.kind}`);
    lines.push(`- author: ${comment?.user?.login || "unknown"}`);
    lines.push(`- at: ${comment?.created_at || comment?.updated_at || "unknown"}`);
    lines.push(`- message_id: ${comment?.id ?? "unknown"}`);
    lines.push("", "### Body", "", body);
    messageNumber += 1;
  }
  return lines.join("\n");
}
