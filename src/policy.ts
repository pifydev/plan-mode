import { resolve } from "node:path";
import { classifyShellCommand } from "./shell.ts";
import type { PolicyVerdict } from "./types.ts";

/**
 * Tool-call policy while plan mode is active (enforced via the tool_call
 * block hook — the lesson from juanibiapina's deprecation is that an
 * extension earns its existence through real enforcement, not prompts).
 */

const READ_ONLY_BUILTINS = new Set(["read", "grep", "find", "ls"]);

/** Suite tools that are read-only by design and safe during planning. */
const SAFE_TOOL_PREFIXES = ["memory_read", "memory_search", "goal_status", "write_plan", "exit_plan_mode", "enter_plan_mode"];

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

  if (SAFE_TOOL_PREFIXES.some((p) => toolName === p || toolName.startsWith(`${p}:`))) {
    return { kind: "allow" };
  }

  if (call.approvedTools.has(toolName)) return { kind: "allow" };

  return {
    kind: "confirm",
    reason: `custom tool '${toolName}' is not known to be read-only`,
  };
}
