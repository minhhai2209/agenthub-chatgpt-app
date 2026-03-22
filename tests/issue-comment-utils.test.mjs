import assert from "node:assert/strict";

import {
  classifyComment,
  isAutomationComment,
  isDraftFollowUpComment,
} from "../lib/issue-comment-utils.mjs";

const draftFollowUpBody = [
  "<!-- issue-watcher:draft-follow-up -->",
  "Draft reply here.",
].join("\n");

const automationWithQuotedMarker = [
  "@author: agent",
  "@model: gpt-5.3-codex",
  "@reasoning: medium",
  "@thread_id: 019c3739-66a6-76e0-b02b-78c271dac2c4",
  "@last_human: <!-- issue-watcher:draft-follow-up --> Please apply the rule",
  "@run_at: 2026-02-07T08:40:19.968Z",
  "@pid: 5132",
  "@cwd: /Users/hai/workspaces/second-brain/agent-workspaces/158-agenthub",
  "<!-- agent:status:response -->",
  "Applied the rule.",
].join("\n");

const quotedMarkerOnly = [
  "> <!-- issue-watcher:draft-follow-up -->",
  "Human note follows.",
].join("\n");

assert.equal(isDraftFollowUpComment(draftFollowUpBody), true, "draft follow-up marker should match");
assert.equal(isAutomationComment(draftFollowUpBody), false, "draft follow-up is not automation");
assert.equal(classifyComment(draftFollowUpBody).isDraftFollowUp, true, "draft follow-up classification");

assert.equal(isDraftFollowUpComment(automationWithQuotedMarker), false, "quoted marker is not draft follow-up");
assert.equal(isAutomationComment(automationWithQuotedMarker), true, "automation marker should be detected");

assert.equal(isDraftFollowUpComment(quotedMarkerOnly), false, "quoted marker should not match");
assert.equal(isAutomationComment(quotedMarkerOnly), false, "quoted marker alone is not automation");

console.log("issue-comment-utils tests passed");
