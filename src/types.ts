/**
 * Local structural types for @pify/plan-mode.
 * No imports from pi packages: src/ typechecks and runs standalone.
 */

export interface PlanState {
  active: boolean;
  /** Absolute path of the current plan file; edit/write to it is allowed. */
  planFile: string | null;
  /** Thinking level to restore when leaving plan mode. */
  buildThinking: string | null;
  enteredAt: number | null;
}

export const INITIAL_STATE: PlanState = {
  active: false,
  planFile: null,
  buildThinking: null,
  enteredAt: null,
};

/** Verdict for one tool call while plan mode is active. */
export type PolicyVerdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string }
  | { kind: "block"; reason: string };

/** Thinking level plan mode switches to (planning earns deeper thought). */
export const PLAN_THINKING = "high";

export interface BranchEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
