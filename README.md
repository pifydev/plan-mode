# @pify/plan-mode

Read-only planning mode for [pi](https://github.com/earendil-works/pi) with an explicit approve-then-execute gate — enforced at the tool level, not just prompted.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install plan-mode`](https://github.com/pifydev/cli) or `pi install npm:@pify/plan-mode`.

## What it does

- **Two ways in**: you type `/plan` (or `pi --plan`, or `Ctrl+Alt+P`) — or the agent itself calls `enter_plan_mode` before a complex task and tells you.
- **Real enforcement** via the `tool_call` hook while planning:
  - `edit`/`write` are blocked — except on the current plan file (guarded plan editing);
  - `bash` runs through a three-tier classifier: known read-only commands run, known mutators (rm/mv/npm install/git commit/redirects/…) are blocked, unknown commands ask you once;
  - unknown custom tools need a one-time confirmation; suite read-only tools (memory_read, goal_status, …) pass.
- **Plans are files**: `write_plan` creates `.pi/plans/YYYY-MM-DD-<slug>.md` — reviewable, editable during planning, committable.
- **Claude-style exit gate**: `exit_plan_mode` presents up to 3 alternative approaches ("(Recommended)" marked) and an approval menu — implement here, implement in a **fresh session** (handoff message included), revise with feedback, or discard.
- **Thinking split**: entering plan mode raises the thinking level to `high`; your previous level is restored on exit.
- **Persistent**: mode and plan file survive `/reload`, resume, and branch switches; a `📋 plan` footer badge shows while active.

> Plan mode is tool-level workflow protection, not a sandbox: a command you confirm can still do anything you can.

## Usage

```
/plan                      # toggle plan mode
/plan add oauth login      # enter + start planning this
/plan off                  # leave without approval
/plan list                 # saved plans in .pi/plans/ (v0.2)
/plan open oauth           # reopen a saved plan by name or fragment (v0.4)
/plan steps                # progress through the approved plan (v0.3)
/plan export [file]        # standalone HTML next to the plan (v0.3)
pi --plan                  # start a session already in plan mode
```

**Reopening** (v0.4): `/plan open <file>` accepts a filename, a stem, or any distinctive fragment. It hands the plan text back to the agent as a hidden message and restarts step tracking by re-parsing the file — the file is the source of truth, not the step list it produced last time.

## Conflicts

`@pify/plan-mode` registers the `--plan` flag and `/plan` command, so it cannot run alongside `@narumitw/pi-plan-mode` or other plan extensions. Remove those first:

```bash
pi remove npm:@narumitw/pi-plan-mode
pify install plan-mode
```

## After approval (v0.3)

An approved plan becomes a tracked step list rather than a document the agent re-reads each turn — which is how plans get quietly abandoned halfway. Steps are parsed from the markdown the agent already wrote (numbered list, or the bullets under a *Steps*-ish heading), so there is no second source of truth.

- `plan_step_done(index, evidence)` — the agent ticks off one step at a time, with evidence, and gets the next one back. Completing out of order is allowed but reported: the answer names the steps still open before it.
- The status badge follows execution — `📋 2/7 steps` — instead of disappearing at approval.
- `/plan steps` shows the list; progress survives `/reload` and branch switches with the rest of the plan state.

`/plan export` writes a self-contained HTML file next to the plan: no assets, no network, everything escaped before rendering — a plan containing HTML is shown as text, not executed.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
