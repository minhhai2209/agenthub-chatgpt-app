import { AUTHOR_MARKER, LEGACY_CODEX_AUTHOR_MARKER } from "./issue-labels.mjs";

const DRAFT_FOLLOW_UP_MARKER = "<!-- issue-watcher:draft-follow-up -->";

function stripBom(text) {
  if (!text) return "";
  return String(text).replace(/^\uFEFF/, "");
}

function firstNonWhitespaceLine(body) {
  if (!body) return "";
  const lines = String(body).split("\n");
  for (const rawLine of lines) {
    const line = stripBom(String(rawLine || "").trim());
    if (line) return line;
  }
  return "";
}

function isDraftFollowUpComment(body) {
  if (!body) return false;
  const firstLine = firstNonWhitespaceLine(body);
  return firstLine === DRAFT_FOLLOW_UP_MARKER;
}

function classifyComment(body) {
  if (!body) {
    return { isAutomation: false, isDraftFollowUp: false, reason: "empty" };
  }
  const firstLine = firstNonWhitespaceLine(body);
  if (firstLine === DRAFT_FOLLOW_UP_MARKER) {
    return { isAutomation: false, isDraftFollowUp: true, reason: "draft-follow-up-marker" };
  }
  if (firstLine.startsWith("<!-- issue-watcher:")) {
    return { isAutomation: true, isDraftFollowUp: false, reason: "issue-watcher-marker" };
  }
  const lines = String(body).split("\n");
  const authorMarker = AUTHOR_MARKER.toLowerCase();
  const legacyAuthorMarker = LEGACY_CODEX_AUTHOR_MARKER.toLowerCase();
  for (const rawLine of lines) {
    const line = stripBom(String(rawLine || "").trim());
    if (!line) continue;
    const normalizedLine = line.toLowerCase();
    if (normalizedLine === authorMarker) {
      return { isAutomation: true, isDraftFollowUp: false, reason: "author-marker" };
    }
    if (normalizedLine === legacyAuthorMarker) {
      return { isAutomation: true, isDraftFollowUp: false, reason: "legacy-author-marker" };
    }
    if (normalizedLine.startsWith("@model:")) {
      return { isAutomation: true, isDraftFollowUp: false, reason: "model-marker" };
    }
  }
  return { isAutomation: false, isDraftFollowUp: false, reason: "no-automation-marker" };
}

function isAutomationComment(body) {
  return classifyComment(body).isAutomation;
}

export {
  DRAFT_FOLLOW_UP_MARKER,
  classifyComment,
  isAutomationComment,
  isDraftFollowUpComment,
};
