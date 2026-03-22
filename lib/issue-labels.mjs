// Canonical AgentHub label scheme (do not reintroduce legacy `codex:*`, `model:*`, `reasoning:*`):
// - Executor label: `agent`
// - Status labels: `agent:status:*` (todo/seen/doing/done/failed)
// - Codex selectors: `agent:codex:model:*` and `agent:codex:reasoning:*`
const AGENT_EXECUTOR_LABEL = "agent";

const MACHINE_LABEL_PREFIX = "machine:";
const MILESTONE_LABEL_PREFIX = "milestone:";
const SOURCE_LABEL_PREFIX = "source:";

const NO_MILESTONE_LABEL = "milestone:none";

const MODEL_LABEL_PREFIX = "agent:codex:model:";
const REASONING_LABEL_PREFIX = "agent:codex:reasoning:";

const STATUS_NAMES = ["todo", "seen", "doing", "done", "failed"];

const STATUS_LABEL_PREFIX = "agent:status:";
const LEGACY_ALT_STATUS_LABEL_PREFIX = "agent-status:";

const STATUS_LABELS = Object.freeze(
  Object.fromEntries(STATUS_NAMES.map((name) => [name, `${STATUS_LABEL_PREFIX}${name}`])),
);

const LEGACY_ALT_STATUS_LABELS = Object.freeze(
  Object.fromEntries(STATUS_NAMES.map((name) => [name, `${LEGACY_ALT_STATUS_LABEL_PREFIX}${name}`])),
);

const STATUS_LABEL_VARIANTS = Object.freeze(
  Object.fromEntries(
    STATUS_NAMES.map((name) => [
      name,
      [STATUS_LABELS[name], LEGACY_ALT_STATUS_LABELS[name]].filter(Boolean),
    ]),
  ),
);

const COMMAND_LABEL_PREFIX = "command:";
const RENAME_LABEL = `${COMMAND_LABEL_PREFIX}rename`;
const REHYDRATE_LABEL = `${COMMAND_LABEL_PREFIX}rehydrate`;

const BASE_LABELS = new Set([
  AGENT_EXECUTOR_LABEL,
  ...Object.values(STATUS_LABELS),
  ...Object.values(LEGACY_ALT_STATUS_LABELS),
  RENAME_LABEL,
  REHYDRATE_LABEL,
]);

const STATUS_LABEL_ALIASES = new Map(
  STATUS_NAMES.flatMap((name) => {
    const statusLabel = STATUS_LABELS[name];
    const legacyStatusLabels = [LEGACY_ALT_STATUS_LABELS[name]].filter(Boolean);
    return [
      [name, name],
      [statusLabel, name],
      ...legacyStatusLabels.map((label) => [label, name]),
    ];
  }),
);

const RESPONSE_MARKER = "<!-- agent:status:response -->";
const AUTHOR_MARKER = `@author: ${AGENT_EXECUTOR_LABEL}`;

const LEGACY_CODEX_RESPONSE_MARKER = "<!-- agent-status:response -->";
const LEGACY_CODEX_AUTHOR_MARKER = "@author: agent";

function normalizeStatusLabel(label) {
  if (!label) return null;
  const normalized = label.trim();
  const status = STATUS_LABEL_ALIASES.get(normalized);
  if (!status) return null;
  return {
    status,
    label: STATUS_LABELS[status],
  };
}

export {
  AGENT_EXECUTOR_LABEL,
  AUTHOR_MARKER,
  BASE_LABELS,
  COMMAND_LABEL_PREFIX,
  LEGACY_CODEX_AUTHOR_MARKER,
  LEGACY_CODEX_RESPONSE_MARKER,
  MACHINE_LABEL_PREFIX,
  MILESTONE_LABEL_PREFIX,
  MODEL_LABEL_PREFIX,
  NO_MILESTONE_LABEL,
  REHYDRATE_LABEL,
  RENAME_LABEL,
  REASONING_LABEL_PREFIX,
  RESPONSE_MARKER,
  SOURCE_LABEL_PREFIX,
  STATUS_LABEL_PREFIX,
  STATUS_LABELS,
  STATUS_LABEL_ALIASES,
  STATUS_LABEL_VARIANTS,
  STATUS_NAMES,
  normalizeStatusLabel,
};
