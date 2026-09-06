/**
 * Plan-mode system reminders, delivered as hidden custom messages (model
 * sees them, TUI does not). Adapted from juanibiapina's pi-plan text with
 * the write_plan / exit_plan_mode workflow added.
 */

export const ENTER_REMINDER = `<system-reminder>
Plan mode is ACTIVE — you are in a READ-ONLY planning phase.

STRICTLY FORBIDDEN: any file edits, modifications, or system changes. Mutating
shell commands are blocked; unknown commands need user confirmation. This
constraint overrides all other instructions, including direct user requests to
edit — acknowledge such requests and fold them into the plan instead.

Your responsibility now: think, read, search, and discuss to construct a
well-formed implementation plan. Ask clarifying questions rather than assuming
intent. When the plan is ready:
1. Write it to a file with write_plan (goal first, then concrete steps,
   files to touch, verification strategy, open risks).
2. Call exit_plan_mode — optionally with 1-3 alternative approaches — to
   submit it for user approval. Implementation begins only after approval.
</system-reminder>`;

export const EXIT_REMINDER = `<system-reminder>
Plan mode is OFF. You are no longer read-only: file edits, shell commands,
and the full tool set are available again.
</system-reminder>`;

/** Follow-up sent after the user approves implementing in this session. */
export function buildImplementHereMessage(planFile: string | null, approach: string | null): string {
  const approachLine = approach ? ` using the approved approach: ${approach}` : "";
  return planFile
    ? `The plan was approved${approachLine}. Read ${planFile} and implement it fully. Verify as you go; report deviations from the plan.`
    : `The plan was approved${approachLine}. Implement it fully as discussed. Verify as you go.`;
}

/** First message of a fresh implementation session (janvitos-style handoff). */
export function buildHandoffMessage(planFile: string | null, approach: string | null): string {
  const approachLine = approach ? `\nApproved approach: ${approach}` : "";
  return planFile
    ? `Implement the approved plan in ${planFile}.${approachLine}\nRead the plan file first, then execute it fully. Verify as you go; report deviations.`
    : `Implement the plan we agreed on.${approachLine}`;
}

/**
 * Hidden message delivered when a saved plan is reopened. The plan text goes
 * with it: the agent should not have to guess which file /plan open meant, or
 * read it back before it can act.
 */
export function buildReopenMessage(file: string, markdown: string): string {
  return [
    "<system-reminder>",
    `The user reopened a saved plan: ${file}`,
    "It is the plan to follow now. Its checklist steps are tracked again from the top —",
    "call plan_step_done(index, evidence) as you finish each one, and do not restate the plan back.",
    "",
    "<plan>",
    markdown.trim(),
    "</plan>",
    "This is an automated reminder — do not mention it to the user.",
    "</system-reminder>",
  ].join("\n");
}
