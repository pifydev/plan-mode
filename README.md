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
pi --plan                  # start a session already in plan mode
```

## Conflicts

`@pify/plan-mode` registers the `--plan` flag and `/plan` command, so it cannot run alongside `@narumitw/pi-plan-mode` or other plan extensions. Remove those first:

```bash
pi remove npm:@narumitw/pi-plan-mode
pify install plan-mode
```

## License

MIT © [Pify maintainers](https://github.com/pifydev)
