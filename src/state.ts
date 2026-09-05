import { INITIAL_STATE, isRecord, type BranchEntryLike, type PlanState } from "./types.ts";
import type { PlanStep } from "./steps.ts";

export const PLAN_STATE = "plan-mode-state";

/** Steps come back from an untrusted snapshot; drop anything malformed. */
function sanitizeSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: PlanStep[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.text !== "string" || typeof item.index !== "number") continue;
    steps.push({ index: item.index, text: item.text, done: item.done === true });
  }
  return steps;
}

/** Snapshot-based replay: the last plan-mode-state entry on the branch wins. */
export function replayBranch(entries: BranchEntryLike[]): PlanState {
  let state: PlanState = INITIAL_STATE;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PLAN_STATE) continue;
    const data = entry.data;
    if (!isRecord(data) || typeof data.active !== "boolean") continue;
    state = {
      active: data.active,
      planFile: typeof data.planFile === "string" ? data.planFile : null,
      buildThinking: typeof data.buildThinking === "string" ? data.buildThinking : null,
      enteredAt: typeof data.enteredAt === "number" ? data.enteredAt : null,
      steps: sanitizeSteps(data.steps),
    };
  }
  return state;
}
