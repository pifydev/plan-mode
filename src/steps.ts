/**
 * Step tracking for an approved plan (v0.3, janvitos' plan-execution). A plan
 * is approved as a whole and then executed as a list — without a tracker the
 * agent re-reads the markdown every turn and quietly skips steps.
 *
 * Steps are parsed out of the plan file the agent already wrote, so there is
 * no second source of truth: the markdown stays the plan, this is a cursor
 * over it.
 */

export interface PlanStep {
  /** 1-based position in the plan. */
  index: number;
  text: string;
  done: boolean;
}

const MAX_STEPS = 40;
const MAX_STEP_CHARS = 200;

/** Headings that introduce the step list; anything else is prose. */
const STEP_HEADING = /^#{1,6}\s*(implementation\s+)?(steps|plan|tasks|todo|work)\b/i;
const NON_STEP_HEADING = /^#{1,6}\s*(risk|verification|testing|open question|context|goal|background|note)/i;

function cleanStep(raw: string): string {
  return raw
    .replace(/^\s*(?:\d+[.)]|[-*+]|\[[ xX]\])\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STEP_CHARS);
}

/**
 * Extract the ordered steps from a plan's markdown. Numbered lists win: a
 * plan that numbers its steps means those and only those. Otherwise the
 * bullets under a steps-ish heading are used, which is how most plans that
 * are not numbered are written.
 */
export function parseSteps(markdown: string): PlanStep[] {
  const lines = (markdown ?? "").split("\n");

  const numbered: string[] = [];
  const underHeading: string[] = [];
  let inStepSection = false;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      inStepSection = STEP_HEADING.test(line) && !NON_STEP_HEADING.test(line);
      continue;
    }
    if (/^\s*\d+[.)]\s+\S/.test(line)) {
      // Only top-level numbers: an indented "1." is a detail of a step.
      if (!/^\s{2,}/.test(line)) numbered.push(cleanStep(line));
      continue;
    }
    if (inStepSection && /^\s*[-*+]\s+\S/.test(line) && !/^\s{2,}/.test(line)) {
      underHeading.push(cleanStep(line));
    }
  }

  const chosen = (numbered.length > 0 ? numbered : underHeading).filter(Boolean).slice(0, MAX_STEPS);
  return chosen.map((text, i) => ({ index: i + 1, text, done: false }));
}

/** Merge parsed steps with what was already completed, matching on text. */
export function mergeProgress(steps: PlanStep[], previous: PlanStep[]): PlanStep[] {
  const doneText = new Set(previous.filter((s) => s.done).map((s) => s.text));
  return steps.map((step) => ({ ...step, done: doneText.has(step.text) }));
}

export function nextStep(steps: PlanStep[]): PlanStep | null {
  return steps.find((step) => !step.done) ?? null;
}

export interface CompleteResult {
  steps: PlanStep[];
  step: PlanStep | null;
  error: string | null;
}

/**
 * Mark a step done. Out-of-order completion is allowed but not silent: the
 * caller reports which steps were skipped, since skipping is usually a
 * mistake and occasionally the point.
 */
export function completeStep(steps: PlanStep[], index: number): CompleteResult {
  const target = steps.find((step) => step.index === index);
  if (!target) return { steps, step: null, error: `No step #${index} in the plan (it has ${steps.length}).` };
  if (target.done) return { steps, step: target, error: `Step #${index} is already done.` };
  return {
    steps: steps.map((step) => (step.index === index ? { ...step, done: true } : step)),
    step: target,
    error: null,
  };
}

export function skippedBefore(steps: PlanStep[], index: number): PlanStep[] {
  return steps.filter((step) => step.index < index && !step.done);
}

export function progressLine(steps: PlanStep[]): string {
  const done = steps.filter((s) => s.done).length;
  return `${done}/${steps.length} steps`;
}

const MAX_WIDGET_STEPS = 8;

/** Plain-text step list for a notify or a widget. */
export function formatSteps(steps: PlanStep[], limit = MAX_WIDGET_STEPS): string {
  if (steps.length === 0) return "No steps parsed from the plan.";
  const current = nextStep(steps);
  const start = current ? Math.max(0, Math.min(steps.length - limit, current.index - 1 - 2)) : 0;
  const window = steps.slice(start, start + limit);
  const lines = window.map((step) => {
    const mark = step.done ? "✔" : step === current ? "▸" : "◻";
    return `${mark} ${step.index}. ${step.text.length > 70 ? `${step.text.slice(0, 69)}…` : step.text}`;
  });
  if (start > 0) lines.unshift(`… +${start} above`);
  const after = steps.length - start - window.length;
  if (after > 0) lines.push(`… +${after} more`);
  return [progressLine(steps), ...lines].join("\n");
}
