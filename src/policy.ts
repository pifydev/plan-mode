import { resolve } from "node:path";
import { classifyShellCommand } from "./shell.ts";
import { isRecord, type PolicyVerdict } from "./types.ts";

/**
 * Tool-call policy while plan mode is active (enforced via the tool_call
 * block hook — the lesson from juanibiapina's deprecation is that an
 * extension earns its existence through real enforcement, not prompts).
 */

const READ_ONLY_BUILTINS = new Set(["read", "grep", "find", "ls"]);

/** Suite tools that are read-only by design and safe during planning. */
const SAFE_TOOL_PREFIXES = ["memory_read", "memory_search", "goal_status", "write_plan", "exit_plan_mode", "enter_plan_mode"];

/**
 * Delegation tools spawn CHILD sessions with noExtensions:true, so plan mode's
 * tool_call hook does not run inside them — a child agent edits, writes and
 * runs bash with no gate at all. They must be judged here, at the delegation
 * boundary, and NEVER remembered by tool name (approving one scout run must not
 * silently green-light a later worker run). agent_run / swarm_run are allowed
 * per-call ONLY when every agent they would spawn is a builtin read-only type;
 * workflow can spawn anything a script wants and is blocked outright.
 */
const DELEGATION_TOOLS = new Set(["agent_run", "swarm_run", "workflow"]);

/**
 * Builtin agents that only read (subagent/src/builtin.ts). A project can shadow
 * these names with its own .pi/agents/<name>.md, so a match earns a per-call
 * CONFIRM (with a preview) — never a silent allow.
 */
const READ_ONLY_AGENTS = new Set(["scout", "reviewer"]);

/** Trim + lowercase an agent name; null when it is missing or not a string. */
function normalizeAgent(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/** First ~120 chars of a task string for the confirm preview. */
function taskPreview(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

const USE_READ_ONLY = "Only the read-only agents scout or reviewer may run while planning — use one of those, or leave plan mode to delegate implementation.";

/** agent_run {agent, task, isolation?} — confirm per call for a read-only agent, else block. */
function classifyAgentRun(input: unknown): PolicyVerdict {
  const agent = normalizeAgent((input as { agent?: unknown })?.agent);
  const isolation = (input as { isolation?: unknown })?.isolation;
  if (isolation) {
    return { kind: "block", reason: `Plan mode blocks agent_run with isolation set (a worktree is a mutation). ${USE_READ_ONLY}` };
  }
  if (agent && READ_ONLY_AGENTS.has(agent)) {
    const preview = taskPreview((input as { task?: unknown })?.task);
    return { kind: "confirm", perCall: true, reason: `agent=${agent} task=${preview || "(none)"}` };
  }
  return { kind: "block", reason: `Plan mode blocks agent_run with agent='${agent ?? "(missing)"}'. ${USE_READ_ONLY}` };
}

/** swarm_run {items, agent?, isolation?} — every spawned agent must be read-only, else block. */
function classifySwarmRun(input: unknown): PolicyVerdict {
  const isolation = (input as { isolation?: unknown })?.isolation;
  if (isolation) {
    return { kind: "block", reason: `Plan mode blocks swarm_run with isolation set (a worktree is a mutation). ${USE_READ_ONLY}` };
  }
  const rawItems = (input as { items?: unknown })?.items;
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) {
    return { kind: "block", reason: `Plan mode blocks swarm_run without items. ${USE_READ_ONLY}` };
  }

  const topAgent = normalizeAgent((input as { agent?: unknown })?.agent);
  // The top-level agent is the default for every item that has none, so a
  // non-read-only default is enough to spawn a worker.
  if (topAgent !== null && !READ_ONLY_AGENTS.has(topAgent)) {
    return { kind: "block", reason: `Plan mode blocks swarm_run with agent='${topAgent}'. ${USE_READ_ONLY}` };
  }

  // Every item must resolve to a read-only agent: its own agent, or the
  // top-level default. A string item (or an object with no agent) and no
  // default means routing may pick a worker.
  const names = new Set<string>();
  for (const item of items) {
    const own = isRecord(item) ? normalizeAgent(item.agent) : null;
    const effective = own ?? topAgent;
    if (effective === null) {
      return { kind: "block", reason: `Plan mode blocks swarm_run: an item has no agent and there is no read-only default, so routing may pick a worker. ${USE_READ_ONLY}` };
    }
    if (!READ_ONLY_AGENTS.has(effective)) {
      return { kind: "block", reason: `Plan mode blocks swarm_run with agent='${effective}'. ${USE_READ_ONLY}` };
    }
    names.add(effective);
  }

  const first = items[0];
  const firstTask = typeof first === "string" ? first : isRecord(first) ? (first as { task?: unknown }).task : undefined;
  return { kind: "confirm", perCall: true, reason: `swarm_run ${items.length} item(s), agents ${[...names].join(", ")} — first task: ${taskPreview(firstTask) || "(none)"}` };
}

/** Judge a delegation tool; these are never remembered by name. */
function classifyDelegation(toolName: string, input: unknown): PolicyVerdict {
  if (toolName === "agent_run") return classifyAgentRun(input);
  if (toolName === "swarm_run") return classifySwarmRun(input);
  // workflow {script?, name?, args?, resumeFromRunId?}: a script can spawn any
  // agent, so it is never provably read-only and cannot be classified from its
  // arguments. Block it outright.
  return {
    kind: "block",
    reason: "Plan mode blocks the workflow tool: a workflow script can spawn any agent (including ones that edit, write and run bash), so it cannot be guaranteed read-only while planning — resuming with resumeFromRunId does not change that. Use scout or reviewer for read-only delegation, or leave plan mode to run a workflow.",
  };
}

export interface PolicyInput {
  toolName: string;
  input: unknown;
  planFile: string | null;
  /** Custom tool names the user already confirmed this session. */
  approvedTools: ReadonlySet<string>;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase();
  return norm(a) === norm(b);
}

export function classifyToolCall(call: PolicyInput): PolicyVerdict {
  const { toolName } = call;

  if (READ_ONLY_BUILTINS.has(toolName)) return { kind: "allow" };

  if (toolName === "edit" || toolName === "write") {
    const path = (call.input as { path?: unknown })?.path;
    if (typeof path === "string" && call.planFile && samePath(path, call.planFile)) {
      // Guarded plan-file editing (janvitos): the plan itself is writable.
      return { kind: "allow" };
    }
    return {
      kind: "block",
      reason: call.planFile
        ? `Plan mode blocks '${toolName}' except on the current plan file (${call.planFile}). Use write_plan first if you have no plan file.`
        : `Plan mode blocks '${toolName}'. Create a plan with write_plan; implementation starts after exit_plan_mode is approved.`,
    };
  }

  if (toolName === "bash") {
    const command = (call.input as { command?: unknown })?.command;
    if (typeof command !== "string") return { kind: "block", reason: "bash call without a command" };
    const verdict = classifyShellCommand(command);
    if (verdict.kind === "block") {
      return { kind: "block", reason: `Plan mode blocks this command: ${verdict.reason}.` };
    }
    return verdict;
  }

  if (toolName === "powershell") {
    return {
      kind: "block",
      reason: "Plan mode blocks powershell (no read-only classifier). Use the bash tool for read-only inspection.",
    };
  }

  if (DELEGATION_TOOLS.has(toolName)) {
    return classifyDelegation(toolName, call.input);
  }

  if (SAFE_TOOL_PREFIXES.some((p) => toolName === p || toolName.startsWith(`${p}:`))) {
    return { kind: "allow" };
  }

  if (call.approvedTools.has(toolName)) return { kind: "allow" };

  return {
    kind: "confirm",
    reason: `custom tool '${toolName}' is not known to be read-only`,
  };
}
