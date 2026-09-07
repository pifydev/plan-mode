---
name: plan-mode
description: Use when a task is complex, risky, spans many files, or the user asks for a plan first - explains the plan-mode workflow (enter_plan_mode, write_plan, exit_plan_mode approval gate) and the read-only discipline
---

# Plan mode

This project has the `@pify/plan-mode` extension installed. It provides a
read-only planning phase with an explicit approve-then-execute gate.

## When to enter plan mode yourself (enter_plan_mode)

- The task spans multiple files or subsystems.
- Requirements are ambiguous and worth clarifying before touching code.
- The change is risky (migrations, deletions, public APIs).
- The user says "plan first", "don't code yet", or similar.

Do not enter plan mode for trivial single-file edits.

## The workflow

1. `enter_plan_mode` — switches to read-only; thinking level is raised.
2. Explore with read, grep, find, ls, and read-only shell commands. Mutating
   commands are blocked; unknown ones ask the user. Do not fight the policy —
   fold blocked actions into the plan instead.
3. Ask the user clarifying questions rather than assuming intent.
4. `write_plan` — write the full plan (goal, concrete steps, files to touch,
   verification, risks) to `.pi/plans/`. The plan file itself stays editable.
5. `exit_plan_mode` — submit with a one-paragraph summary; optionally offer
   1-3 alternative approaches, marking one "(Recommended)". The user approves
   (here or in a fresh session), requests revisions, or discards.
6. After approval, implement the plan exactly; report any deviation.
   An approved plan is frozen: do not quietly rewrite the plan file so it
   matches what you ended up doing. Track progress with `plan_step_done`,
   and if the plan turns out to be wrong, say so and re-plan in the open.

## While plan mode is active

- Never promise to make changes now; everything lands in the plan.
- A blocked tool call is a policy decision, not an error to retry.
