import type { PolicyVerdict } from "./types.ts";

/**
 * Three-tier shell policy for plan mode (bacnh85's design):
 * known read-only commands run automatically, known mutators are blocked
 * outright, and everything else needs a one-time user confirmation.
 *
 * This is tool-level workflow protection, NOT a sandbox (doompi's honest
 * caveat): a confirmed command can still do anything the user can.
 */

const SAFE_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "less", "more", "wc", "file", "stat", "du", "df",
  "grep", "egrep", "fgrep", "rg", "find", "fd", "tree", "dirname", "basename",
  "pwd", "whoami", "which", "where", "type", "env", "printenv", "date", "uname",
  "echo", "printf", "sort", "uniq", "cut", "tr", "diff", "cmp", "md5sum",
  "sha256sum", "readlink", "realpath", "jq", "yq", "column", "nl", "strings",
  "node", "python", "python3", "bun", "deno",
]);

/** git subcommands that only read. Everything else confirms/blocks. */
const SAFE_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "tag", "remote", "blame",
  "shortlog", "describe", "rev-parse", "rev-list", "ls-files", "ls-remote",
  "ls-tree", "cat-file", "reflog", "stash list", "config --get", "grep",
]);

const MUTATOR_COMMANDS = new Set([
  "rm", "rmdir", "mv", "cp", "mkdir", "touch", "tee", "chmod", "chown", "ln",
  "dd", "truncate", "shred", "install", "patch", "rsync", "curl", "wget",
  "npm", "npx", "yarn", "pnpm", "pip", "pip3", "cargo", "gem", "brew", "apt",
  "apt-get", "yum", "dnf", "choco", "winget", "scoop", "sudo", "kill",
  "killall", "shutdown", "reboot",
]);

const MUTATOR_GIT_SUBCOMMANDS = [
  "commit", "push", "add", "rm", "mv", "reset", "checkout", "switch", "merge",
  "rebase", "cherry-pick", "revert", "clean", "stash push", "stash pop",
  "stash drop", "apply", "am", "fetch", "pull", "clone", "init", "restore",
  "config --set", "config --global", "config --local",
];

/** Split a shell line on operators; each segment is judged independently. */
export function splitSegments(command: string): string[] {
  return command
    .split(/(?:\|\||&&|;|\|)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip leading VAR=value assignments so env prefixes cannot mask commands. */
function stripEnvPrefix(segment: string): string {
  return segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
}

function leadingCommand(segment: string): string {
  const first = stripEnvPrefix(segment).split(/\s+/)[0] ?? "";
  return first.replace(/^["']|["']$/g, "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

/** Redirects can write files; only /dev/null and stderr merges are harmless. */
export function hasWritingRedirect(command: string): boolean {
  const cleaned = command
    .replace(/2>&1/g, "")
    .replace(/[0-9]?>>?\s*\/dev\/null/g, "")
    .replace(/[0-9]?>\s*&[0-9]/g, "");
  return />/.test(cleaned);
}

export function classifyShellCommand(command: string): PolicyVerdict {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "allow" };

  if (hasWritingRedirect(trimmed)) {
    return { kind: "block", reason: "output redirection writes files" };
  }

  for (const segment of splitSegments(trimmed)) {
    const cmd = leadingCommand(segment);
    if (cmd === "git") {
      const rest = stripEnvPrefix(segment).replace(/^\S+\s*/, "").trim();
      if (MUTATOR_GIT_SUBCOMMANDS.some((m) => rest.startsWith(m))) {
        return { kind: "block", reason: `git ${rest.split(/\s+/)[0]} mutates the repository` };
      }
      const safe = [...SAFE_GIT_SUBCOMMANDS].some((s) => rest.startsWith(s));
      if (!safe) return { kind: "confirm", reason: `unrecognized git subcommand: ${rest.split(/\s+/)[0] ?? ""}` };
      continue;
    }
    if (MUTATOR_COMMANDS.has(cmd)) {
      return { kind: "block", reason: `'${cmd}' modifies the system` };
    }
    if (!SAFE_COMMANDS.has(cmd)) {
      return { kind: "confirm", reason: `unrecognized command: '${cmd}'` };
    }
    // Safe interpreters running inline code can still write files.
    if (["node", "python", "python3", "bun", "deno"].includes(cmd) && /\s-(e|c|p|-eval)\b/.test(segment)) {
      return { kind: "confirm", reason: `inline ${cmd} code can modify files` };
    }
  }
  return { kind: "allow" };
}
