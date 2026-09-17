# @pify/plan-mode

[![CI](https://github.com/pifydev/plan-mode/actions/workflows/ci.yml/badge.svg)](https://github.com/pifydev/plan-mode/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@pify/plan-mode)](https://www.npmjs.com/package/@pify/plan-mode) [![npm downloads](https://img.shields.io/npm/dm/@pify/plan-mode)](https://www.npmjs.com/package/@pify/plan-mode)

Read-only planning mode for [pi](https://github.com/earendil-works/pi) with an explicit approve-then-execute gate — enforced at the tool level, not just prompted.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install plan-mode`](https://github.com/pifydev/cli) or `pi install npm:@pify/plan-mode`.

## Why

"Plan first, then implement" works right up until the model decides the plan is obvious enough to skip. A prompt asking it to hold off is a request; a tool hook that refuses the write is an answer. This is the second kind.

> Plan mode is tool-level workflow protection, not a sandbox. A command you confirm can still do anything you can.

## Two ways in

You type `/plan`, start with `pi --plan`, or press `Ctrl+Alt+P`. Or the agent calls `enter_plan_mode` itself before a task it judges complex, and tells you it did.

## What is enforced

While planning, the `tool_call` hook stands in front of everything:

- **`edit` and `write` are blocked** — except on the current plan file, so the plan itself stays editable.
- **`bash` runs through a three-tier classifier.** Known read-only commands run. Known mutators — `rm`, `mv`, `npm install`, `git commit`, output redirects and the rest — are blocked. Anything unrecognised asks you once.
  - Interpreters (`node`, `python`, `python3`, `bun`, `deno`) run only for `--version`/`--help` style queries. Anything else — a script path, `bun install`, `deno run`, `-e`/`-c` inline code, `python -m pip` — asks first, because it runs code the classifier cannot see into.
  - `env` is unwrapped: `env rm -rf x` is judged as `rm -rf x` and blocked, `env FOO=1 cat file` runs, bare `env` and `printenv` run. `env -S` (and any other option that could build a command line) asks first.
  - **A `>` inside quotes is a search pattern, not a redirect.** `grep -rn "=>" src`, `rg '->'` and `git log --format="%h > %s"` read normally; only an *unquoted* `>` (`echo x > file`) is a write. Unbalanced quotes fail safe and are blocked.
  - **Write modes hidden behind flags still ask.** `sort -o`, `yq -i`, `uniq IN OUT`, and `find` with `-delete`/`-exec`/`-ok`/`-fprint`/`-fls` write files or run commands despite being read-ish, so each asks first.
- **Unknown custom tools need a one-time confirmation.** Read-only tools from this suite (`memory_read`, `goal_status`, …) pass without asking.
- **Delegation is judged per call, at the boundary.** `agent_run`, `swarm_run` and `workflow` spawn child sessions that run *without* extensions — plan mode's hook cannot reach inside them, so a child would edit and run bash freely. They are therefore gated here and never remembered by name (approving one scout run cannot green-light a later worker run):
  - `agent_run` asks every time when the agent is a builtin read-only type (`scout` or `reviewer`), showing `agent=… task=…`; any other agent, a missing agent, or `isolation` set is **blocked** — use `scout`/`reviewer` while planning, or leave plan mode.
  - `swarm_run` inspects the top-level agent *and* every item's own agent; it asks only when all of them are read-only. Any other name, an item with no agent and no read-only default (routing may pick a worker), or `isolation` set is **blocked**.
  - `workflow` is **always blocked** in plan mode — a workflow script can spawn any agent, so it is never provably read-only (resuming with `resumeFromRunId` does not change that).

## Plans are files

`write_plan` creates `.pi/plans/YYYY-MM-DD-<slug>.md`. It is reviewable while you plan, editable by hand, and committable — a plan that only exists in a conversation is a plan you cannot review tomorrow.

## The exit gate

`exit_plan_mode` presents up to three alternative approaches, with the recommended one marked, and an approval menu:

- implement here,
- implement in a **fresh session** — the handoff message comes with it,
- revise with your feedback,
- or discard.

## After approval

An approved plan becomes a tracked step list rather than a document the agent re-reads each turn, which is how plans get quietly abandoned halfway. Steps are parsed from the markdown the agent already wrote — a numbered list, or the bullets under a *Steps*-ish heading — so there is no second source of truth.

- `plan_step_done(index, evidence)` ticks off one step with evidence and hands back the next. Completing out of order is allowed but reported: the answer names the steps still open before it.
- The status badge follows execution — `📋 2/7 steps` — instead of disappearing at approval.
- `/plan steps` shows the list, and progress survives `/reload` and branch switches with the rest of the plan state.

## Usage

```
/plan                      # toggle plan mode
/plan add oauth login      # enter, and start planning this
/plan off                  # leave without approval
/plan list                 # saved plans in .pi/plans/
/plan open oauth           # reopen a saved plan by name or fragment
/plan steps                # progress through the approved plan
/plan export [file]        # standalone HTML next to the plan
pi --plan                  # start a session already in plan mode
```

**Reopening** accepts a filename, a stem, or any distinctive fragment. It hands the plan text back to the agent as a hidden message and restarts step tracking by re-parsing the file — the file is the source of truth, not the step list it produced last time.

**Export** writes a self-contained HTML file next to the plan: no assets, no network, and everything escaped before rendering, so a plan containing HTML is shown as text rather than executed.

## Behaviour

- **Thinking split.** Entering plan mode raises the thinking level to `high`; your previous level is restored on exit. Planning is the part worth thinking hard about.
- **Persistent.** Mode, plan file and step progress survive `/reload`, resume and branch switches. A `📋 plan` badge shows in the footer while active.
- **`--plan` scope.** The `--plan` flag auto-enters plan mode for the initial session and for `/new`. On `/reload`, resume and fork the replayed snapshot is trusted instead, so an approved plan's tracked steps are never wiped by re-entering.
- **`/plan <prompt>` mid-turn.** Typing `/plan rework the caching layer` while the agent is streaming enters plan mode and queues your prompt as a follow-up, so it runs under plan-mode enforcement after the current turn rather than being dropped.

## Conflicts

This extension registers the `--plan` flag and the `/plan` command, so it cannot run alongside another planning extension that claims either. Remove the other one first:

```bash
pi remove npm:<the-other-plan-extension>
pify install plan-mode
```

## License

MIT © [Pify maintainers](https://github.com/pifydev)
