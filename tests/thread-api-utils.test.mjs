import assert from "node:assert/strict";

import {
  buildWriteGuard,
  findLatestAiResponse,
  renderTranscriptMarkdown,
  resolveNextHumanMessage,
  resolveUpsertDecision,
} from "../lib/thread-api-utils.mjs";

const aiResponseOne = [
  "@author: agent",
  "@model: gpt-5.4",
  "<!-- agent:status:response -->",
  "First response",
].join("\n");

const aiResponseTwo = [
  "@author: agent",
  "@model: gpt-5.4",
  "<!-- agent:status:response -->",
  "Second response",
].join("\n");

const draftFollowUp = [
  "<!-- issue-watcher:draft-follow-up -->",
  "Suggested next step",
].join("\n");

const commentsForDraft = [
  { id: 1, body: aiResponseOne, created_at: "2026-03-01T00:00:00Z", user: { login: "owner" } },
  { id: 2, body: draftFollowUp, created_at: "2026-03-01T00:01:00Z", user: { login: "owner" } },
];

const commentsForHuman = [
  ...commentsForDraft,
  { id: 3, body: "Please continue with the suggested step.", created_at: "2026-03-01T00:02:00Z", user: { login: "owner" } },
];

const commentsForConflict = [
  { id: 11, body: aiResponseTwo, created_at: "2026-03-02T00:00:00Z", user: { login: "owner" } },
  { id: 12, body: "I added a follow-up manually.", created_at: "2026-03-02T00:05:00Z", user: { login: "other-user" } },
];

assert.equal(findLatestAiResponse(commentsForConflict)?.comment?.id, 11, "latest AI response should be detected");
assert.equal(resolveNextHumanMessage(commentsForDraft).source, "codex-draft-follow-up", "draft should be used when no human comment exists");
assert.equal(resolveNextHumanMessage(commentsForHuman).source, "human", "explicit human should win over draft");

const createDecision = resolveUpsertDecision({ comments: commentsForDraft, viewerLogin: "owner" });
assert.equal(createDecision.action, "create", "draft-only state should create a new comment");

const editDecision = resolveUpsertDecision({ comments: commentsForHuman, viewerLogin: "owner" });
assert.equal(editDecision.action, "edit", "latest human comment from viewer should be editable");
assert.equal(editDecision.target?.id, 3);

const conflictDecision = resolveUpsertDecision({ comments: commentsForConflict, viewerLogin: "owner" });
assert.equal(conflictDecision.action, "conflict", "other-user human comment should block upsert");

assert.equal(buildWriteGuard(["agent:status:done"]).allowed, true, "done-only should allow writes");
assert.equal(buildWriteGuard(["agent:status:doing"]).allowed, false, "doing should block writes");

const transcript = renderTranscriptMarkdown({
  issue: { body: "Initial request", created_at: "2026-03-01T00:00:00Z", user: { login: "owner" } },
  comments: commentsForHuman,
});
assert.match(transcript, /kind: thread-start/, "thread start should be present");
assert.match(transcript, /kind: ai-response/, "AI response should be classified");
assert.match(transcript, /kind: codex-draft-follow-up/, "draft should be classified");
assert.match(transcript, /kind: human/, "human follow-up should be classified");

console.log("thread-api-utils tests passed");
