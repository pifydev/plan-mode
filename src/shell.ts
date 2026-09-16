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

/**
 * Split a shell line on operators; each segment is judged independently.
 * Multi-char operators are matched before their single-char prefixes so "&&"
 * wins over a standalone "&" (background). Newlines and carriage returns end a
 * command just like ";", and a lone "&" backgrounds one, so a mutator sitting
 * after any of them must not ride in on the first segment's verdict. The
 * background "&" is only split when it is not part of an fd merge like "2>&1"
 * (preceded by ">") and not the first "&" of "&&" (followed by "&").
 */
export function splitSegments(command: string): string[] {
  return command
    .split(/\|\||&&|;|\||[\r\n]|(?<!>)&(?!&)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Command/process substitution executes arbitrary code even when the outer
 * command looks read-only (e.g. `echo $(rm -rf x)`), so any segment carrying
 * one must never auto-allow.
 */
function hasSubstitution(segment: string): boolean {
  return segment.includes("$(") || segment.includes("`") || segment.includes("<(");
}

/** Read-only forms of `git remote` (bare, listing, or url lookup). */
const GIT_REMOTE_READONLY = /^(?:-v|-vv|--verbose|show|get-url)$/;
/** Flags that turn `git branch` into a mutation (delete/rename/copy/upstream). */
const GIT_BRANCH_DESTRUCTIVE = /^(?:-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-u|--set-upstream-to|--unset-upstream|--edit-description|-f|--force)$/;
/** Flags that keep `git branch` in listing mode (their positionals are patterns). */
const GIT_BRANCH_LIST_FLAGS = /^(?:-a|--all|-r|--remotes|-v|-vv|--verbose|-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--format|--color|--no-color|--column|--no-column|-i|--ignore-case)$/;
/** Flags that make `git tag` create/delete/sign a tag rather than list. */
const GIT_TAG_DESTRUCTIVE = /^(?:-d|--delete|-a|--annotate|-s|--sign|-u|--local-user|-f|--force|-m|--message|-F|--file|-e|--edit|--create-reflog)$/;
/** Flags that keep `git tag` in listing mode. */
const GIT_TAG_LIST_FLAGS = /^(?:-l|--list|-n\d*|--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--format|--color|--column|--no-column|-i|--ignore-case)$/;

/**
 * Decide whether a `git branch|tag|remote` invocation is read-only (allow) or
 * could create/delete/modify a ref (confirm). Bare and listing forms are safe;
 * a destructive flag, an unknown flag, or a bare positional outside a listing
 * context (i.e. creating a branch/tag) all require confirmation.
 */
function gitRefVerdict(sub: "branch" | "tag" | "remote", args: string[]): "allow" | "confirm" {
  if (sub === "remote") {
    if (args.length === 0) return "allow";
    return GIT_REMOTE_READONLY.test(args[0] ?? "") ? "allow" : "confirm";
  }
  const destructive = sub === "branch" ? GIT_BRANCH_DESTRUCTIVE : GIT_TAG_DESTRUCTIVE;
  const listFlags = sub === "branch" ? GIT_BRANCH_LIST_FLAGS : GIT_TAG_LIST_FLAGS;
  let hasListFlag = false;
  let hasPositional = false;
  for (const arg of args) {
    if (destructive.test(arg)) return "confirm";
    if (arg.startsWith("-")) {
      if (listFlags.test(arg) || listFlags.test(arg.split("=")[0] ?? "")) hasListFlag = true;
      else return "confirm"; // unknown flag: fail safe
    } else {
      hasPositional = true;
    }
  }
  // A bare positional with no listing flag means "create this ref".
  if (hasPositional && !hasListFlag) return "confirm";
  return "allow";
}

/** Strip leading VAR=value assignments so env prefixes cannot mask commands. */
function stripEnvPrefix(segment: string): string {
  return segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
}

/** A shell-style VAR=value token (same shape stripEnvPrefix accepts). */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** env options that take no argument and cannot change what gets executed. */
const ENV_BARE_FLAGS = /^(?:-i|--ignore-environment|-0|--null)$/;
/** env options whose argument is the next token (`-u NAME`, `-C DIR`). */
const ENV_VALUE_FLAGS = /^(?:-u|--unset|-C|--chdir)$/;
/** Same options in `--opt=value` form. */
const ENV_INLINE_VALUE_FLAGS = /^--(?:unset|chdir)=/;

/**
 * `env [opts] [VAR=value...] cmd args` is just `cmd args` with a different
 * environment, so the wrapped command must be the one judged — otherwise
 * `env rm -rf x` rides in on env's own safe-list entry. Returns the wrapped
 * command line, "" when env would only print the environment, or null when
 * an option we cannot see through is present: -S/--split-string turns a
 * quoted string into a whole command line, and anything else unknown gets
 * the same fail-safe treatment.
 */
function unwrapEnv(segment: string): string | null {
  const tokens = stripEnvPrefix(segment).split(/\s+/).slice(1).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token === "--") { i++; break; }
    if (ENV_ASSIGNMENT.test(token) || ENV_BARE_FLAGS.test(token) || ENV_INLINE_VALUE_FLAGS.test(token)) { i++; continue; }
    if (ENV_VALUE_FLAGS.test(token)) { i += 2; continue; }
    if (token.startsWith("-")) return null;
    break;
  }
  return tokens.slice(i).join(" ");
}

/** Interpreters worth allowing for version/help queries but never for code. */
const INTERPRETERS = new Set(["node", "python", "python3", "bun", "deno"]);
/** The only interpreter arguments that cannot execute anything. */
const INTERPRETER_QUERY_FLAGS = /^(?:--version|-v|-V|-version|--help|-h)$/;
/** fd merges like `2>&1`; hasWritingRedirect already judged them harmless. */
const FD_MERGE = /^[0-9]?>&[0-9]$/;

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

/** Verdict for one operator-free segment; the strictest segment wins overall. */
function classifySegment(segment: string): PolicyVerdict {
  const cmd = leadingCommand(segment);
  if (cmd === "git") {
    const rest = stripEnvPrefix(segment).replace(/^\S+\s*/, "").trim();
    const gitTokens = rest.split(/\s+/).filter(Boolean);
    const sub = gitTokens[0] ?? "";
    if (MUTATOR_GIT_SUBCOMMANDS.some((m) => rest.startsWith(m))) {
      return { kind: "block", reason: `git ${sub} mutates the repository` };
    }
    if (hasSubstitution(segment)) {
      return { kind: "confirm", reason: "command substitution runs code" };
    }
    // branch/tag/remote read like list commands but also create/delete refs.
    if (sub === "branch" || sub === "tag" || sub === "remote") {
      if (gitRefVerdict(sub, gitTokens.slice(1)) === "confirm") {
        return { kind: "confirm", reason: `git ${sub} with this form can modify refs` };
      }
      return { kind: "allow" };
    }
    const safe = [...SAFE_GIT_SUBCOMMANDS].some((s) => rest.startsWith(s));
    if (!safe) return { kind: "confirm", reason: `unrecognized git subcommand: ${sub}` };
    return { kind: "allow" };
  }
  if (cmd === "env") {
    const inner = unwrapEnv(segment);
    if (inner === null) {
      return { kind: "confirm", reason: "env option can build an arbitrary command line" };
    }
    if (inner) {
      const verdict = classifySegment(inner);
      // Substitution in env's own arguments (`env FOO=$(rm x) cat f`) runs
      // code the wrapped command never sees, so it cannot inherit its allow.
      if (verdict.kind === "allow" && hasSubstitution(segment)) {
        return { kind: "confirm", reason: "command substitution runs code" };
      }
      return verdict;
    }
    // Bare `env` only prints the environment: fall through to the safe list.
  }
  if (MUTATOR_COMMANDS.has(cmd)) {
    return { kind: "block", reason: `'${cmd}' modifies the system` };
  }
  if (hasSubstitution(segment)) {
    return { kind: "confirm", reason: "command substitution runs code" };
  }
  if (!SAFE_COMMANDS.has(cmd)) {
    return { kind: "confirm", reason: `unrecognized command: '${cmd}'` };
  }
  // Interpreters are only on the safe list for `--version`/`--help` style
  // queries. Anything else — a script path, `bun install`, `deno run`,
  // `-e`/`-c` inline code, `-mpip` — runs code that can write files or
  // install packages, and a REPL with no arguments is never a read-only
  // inspection either. Blocklisting flags lost that race (`-mpip` had no
  // word boundary), so the harmless set is enumerated instead.
  if (INTERPRETERS.has(cmd)) {
    const args = stripEnvPrefix(segment).split(/\s+/).slice(1).filter((t) => t && !FD_MERGE.test(t));
    if (args.length === 0 || !args.every((t) => INTERPRETER_QUERY_FLAGS.test(t))) {
      return { kind: "confirm", reason: `running ${cmd} code can modify files` };
    }
  }
  // `find` can mutate via -delete or -exec/-execdir despite being read-only.
  if (cmd === "find" && /\s-(delete|exec|execdir)\b/.test(segment)) {
    return { kind: "confirm", reason: "find -delete/-exec can modify files" };
  }
  return { kind: "allow" };
}

export function classifyShellCommand(command: string): PolicyVerdict {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "allow" };

  if (hasWritingRedirect(trimmed)) {
    return { kind: "block", reason: "output redirection writes files" };
  }

  for (const segment of splitSegments(trimmed)) {
    const verdict = classifySegment(segment);
    if (verdict.kind !== "allow") return verdict;
  }
  return { kind: "allow" };
}
