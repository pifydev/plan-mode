/**
 * @pify/plan-mode — read-only planning with an explicit approve-then-execute
 * gate.
 *
 * Two ways in: the user types /plan (or starts pi with --plan, or presses
 * ctrl+alt+p), or the agent calls enter_plan_mode before a complex task
 * (Kimi/Claude-style). While active, mutations are blocked at the tool_call
 * hook: edit/write allowed only on the current plan file, bash runs through a
 * three-tier read-only classifier (safe list → confirm → block), unknown
 * custom tools need one-time confirmation. Plans are markdown files in
 * .pi/plans/. exit_plan_mode presents up to 3 alternative approaches and an
 * approval menu; approval implements here or hands off to a fresh session.
 *
 * This is tool-level workflow protection, not a sandbox.
 *
 * Design synthesis: tool_call enforcement + review flow (@narumitw/
 * pi-plan-mode), guarded plan-file editing + fresh-session handoff
 * (janvitos/pi-plan-build), agent-initiated tools + approach options
 * (pi-muselinn-harness), three-tier shell policy + thinking split
 * (@bacnh85/pi-plan), hidden system reminders (juanibiapina/pi-plan).
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { classifyToolCall } from "../src/policy.ts";
import { createPlanFile } from "../src/plans.ts";
import {
  ENTER_REMINDER,
  EXIT_REMINDER,
  buildHandoffMessage,
  buildImplementHereMessage,
} from "../src/prompts.ts";
import { PLAN_STATE, replayBranch } from "../src/state.ts";
import { INITIAL_STATE, PLAN_THINKING, type PlanState } from "../src/types.ts";

const REMINDER_TYPE = "plan-mode-reminder";

type UiContext = ExtensionContext;

export default function planMode(pi: ExtensionAPI) {
  let state: PlanState = INITIAL_STATE;
  const approvedTools = new Set<string>();

  // ── State & UI plumbing ──────────────────────────────────────────────

  function commit(ctx: UiContext, next: PlanState): void {
    state = next;
    pi.appendEntry(PLAN_STATE, next);
    updateBadge(ctx);
  }

  function updateBadge(ctx: UiContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("plan", state.active ? "📋 plan" : undefined);
  }

  function notify(ctx: UiContext, message: string, level: "info" | "warning" | "error"): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
  }

  function sendReminder(content: string): void {
    pi.sendMessage({ customType: REMINDER_TYPE, content, display: false });
  }

  // ── Enter / exit ─────────────────────────────────────────────────────

  function enterPlanMode(ctx: UiContext): boolean {
    if (state.active) return false;
    const buildThinking = pi.getThinkingLevel();
    commit(ctx, {
      active: true,
      planFile: null,
      buildThinking,
      enteredAt: Date.now(),
    });
    try {
      // Planning earns deeper thought (bacnh85); restored on exit.
      pi.setThinkingLevel(PLAN_THINKING as never);
    } catch {
      // model may not support it; fine
    }
    sendReminder(ENTER_REMINDER);
    notify(ctx, "Plan mode ON — read-only. Write the plan with write_plan, submit with exit_plan_mode.", "info");
    return true;
  }

  function leavePlanMode(ctx: UiContext): void {
    if (!state.active) return;
    const restore = state.buildThinking;
    commit(ctx, { ...INITIAL_STATE });
    approvedTools.clear();
    if (restore) {
      try {
        pi.setThinkingLevel(restore as never);
      } catch {
        // fine
      }
    }
    sendReminder(EXIT_REMINDER);
    notify(ctx, "Plan mode OFF.", "info");
  }

  // ── Enforcement ──────────────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!state.active) return undefined;

    const verdict = classifyToolCall({
      toolName: event.toolName,
      input: (event as { input?: unknown }).input,
      planFile: state.planFile,
      approvedTools,
    });

    if (verdict.kind === "allow") return undefined;

    if (verdict.kind === "confirm") {
      if (!ctx.hasUI) {
        return { block: true, reason: `Plan mode: ${verdict.reason} (no UI to confirm — blocked).` };
      }
      const ok = await ctx.ui.confirm(
        "Plan mode",
        `Allow this while planning?\n${verdict.reason}`,
      );
      if (ok) {
        // Bash confirmations are per-command; custom tools are remembered.
        if (event.toolName !== "bash") approvedTools.add(event.toolName);
        return undefined;
      }
      return { block: true, reason: `Plan mode: the user declined (${verdict.reason}).` };
    }

    return { block: true, reason: verdict.reason };
  });

  // ── Lifecycle ────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state = replayBranch(ctx.sessionManager.getBranch() as never);
    approvedTools.clear();
    if (!state.active && pi.getFlag("plan") === true) {
      enterPlanMode(ctx);
      return;
    }
    updateBadge(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    state = replayBranch(ctx.sessionManager.getBranch() as never);
    approvedTools.clear();
    updateBadge(ctx);
  });

  pi.registerFlag("plan", {
    description: "Start the session in plan mode (read-only planning)",
    type: "boolean",
    default: false,
  });

  // ── Agent tools ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "enter_plan_mode",
    label: "Enter plan mode",
    description:
      "Switch into read-only plan mode before a complex or risky implementation task. Explore with " +
      "read-only tools, write the plan with write_plan, then submit it with exit_plan_mode. " +
      "Use when the task spans multiple files, has unclear requirements, or the user asked for a plan.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const entered = enterPlanMode(ctx as UiContext);
      return {
        content: [
          {
            type: "text",
            text: entered
              ? "Plan mode activated. Explore read-only, write the plan with write_plan, submit with exit_plan_mode."
              : "Plan mode is already active.",
          },
        ],
        details: { state },
      };
    },
  });

  pi.registerTool({
    name: "write_plan",
    label: "Write plan",
    description:
      "Write the implementation plan to a markdown file under .pi/plans/. Include the goal, concrete " +
      "steps, files to touch, verification strategy, and open risks. The created file becomes editable " +
      "(edit/write are unblocked for it) so the plan can be refined before exit_plan_mode.",
    parameters: Type.Object({
      title: Type.String({ description: "Short plan title (used for the filename)" }),
      content: Type.String({ description: "Full plan in markdown" }),
    }),
    async execute(_id, params: { title: string; content: string }, _signal, _onUpdate, ctx) {
      if (!state.active) {
        throw new Error("write_plan only works in plan mode. Call enter_plan_mode first.");
      }
      const file = createPlanFile((ctx as UiContext).cwd, params.title, params.content);
      commit(ctx as UiContext, { ...state, planFile: file });
      return {
        content: [{ type: "text", text: `Plan written to ${file}. Refine it or call exit_plan_mode.` }],
        details: { file },
      };
    },
  });

  const APPROVE_HERE = "Approve — implement here";
  const APPROVE_FRESH = "Approve — implement in a fresh session";
  const REVISE = "Revise the plan";
  const DISCARD = "Discard and exit plan mode";

  pi.registerTool({
    name: "exit_plan_mode",
    label: "Exit plan mode",
    description:
      "Submit the plan for user approval. Write the plan with write_plan first. Optionally offer 1-3 " +
      "alternative approaches (label + description; append '(Recommended)' to your recommended one; " +
      "labels must not be Approve/Revise/Discard). The user approves, asks for revisions, or discards.",
    parameters: Type.Object({
      summary: Type.String({ description: "One-paragraph summary of the plan for the approval dialog" }),
      options: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({ description: "Approach name, max 80 chars" }),
            description: Type.String({ description: "Trade-offs of this approach" }),
          }),
          { maxItems: 3 },
        ),
      ),
    }),
    async execute(
      _id,
      params: { summary: string; options?: Array<{ label: string; description: string }> },
      _signal,
      _onUpdate,
      ctx,
    ) {
      if (!state.active) {
        throw new Error("Plan mode is not active. Call enter_plan_mode first.");
      }
      const uiCtx = ctx as UiContext;
      if (!uiCtx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "No UI available for the approval dialog. Staying in plan mode — ask the user directly how to proceed.",
            },
          ],
          details: {},
        };
      }

      // Step 1: pick an approach when alternatives were offered.
      let approach: string | null = null;
      const approaches = (params.options ?? []).filter((o) => o.label.trim());
      if (approaches.length > 0) {
        const lines = approaches.map((o) => `${o.label}: ${o.description}`).join("\n");
        const picked = await uiCtx.ui.select(
          `Plan approaches\n${params.summary}\n\n${lines}`,
          [...approaches.map((o) => o.label), REVISE, DISCARD],
        );
        if (picked === undefined || picked === REVISE) {
          const feedback = picked === REVISE ? await uiCtx.ui.input("What should change?") : undefined;
          return {
            content: [
              { type: "text", text: `The user wants revisions.${feedback ? ` Feedback: ${feedback}` : ""} Stay in plan mode and refine the plan.` },
            ],
            details: {},
          };
        }
        if (picked === DISCARD) {
          leavePlanMode(uiCtx);
          return {
            content: [{ type: "text", text: "The user discarded the plan. Plan mode is off; await further instructions." }],
            details: {},
          };
        }
        approach = picked;
      }

      // Step 2: approve where?
      const decision = await uiCtx.ui.select(
        `Approve this plan?\n${params.summary}${state.planFile ? `\n\nPlan file: ${state.planFile}` : ""}`,
        approaches.length > 0 ? [APPROVE_HERE, APPROVE_FRESH] : [APPROVE_HERE, APPROVE_FRESH, REVISE, DISCARD],
      );

      if (decision === undefined || decision === REVISE) {
        const feedback = decision === REVISE ? await uiCtx.ui.input("What should change?") : undefined;
        return {
          content: [
            { type: "text", text: `The user wants revisions.${feedback ? ` Feedback: ${feedback}` : ""} Stay in plan mode and refine the plan.` },
          ],
          details: {},
        };
      }
      if (decision === DISCARD) {
        leavePlanMode(uiCtx);
        return {
          content: [{ type: "text", text: "The user discarded the plan. Plan mode is off; await further instructions." }],
          details: {},
        };
      }

      const planFile = state.planFile;
      leavePlanMode(uiCtx);

      if (decision === APPROVE_FRESH) {
        try {
          const handoff = buildHandoffMessage(planFile, approach);
          // newSession lives on the command context; tool ctx may carry it
          // too at runtime — probe structurally and fall back if absent.
          const sessionHost = uiCtx as unknown as {
            newSession?: (options: {
              withSession: (ctx: { sendUserMessage: (m: string) => void | Promise<void> }) => Promise<void>;
            }) => Promise<{ cancelled: boolean }>;
          };
          if (!sessionHost.newSession) throw new Error("newSession unavailable in this context");
          await sessionHost.newSession({
            withSession: async (replacementCtx) => {
              await replacementCtx.sendUserMessage(handoff);
            },
          });
          return {
            content: [{ type: "text", text: "Approved. A fresh session was started with the plan handoff." }],
            details: { planFile, approach },
          };
        } catch (err) {
          notify(uiCtx, `Fresh session failed (${err instanceof Error ? err.message : String(err)}) — implementing here.`, "warning");
        }
      }

      pi.sendUserMessage(buildImplementHereMessage(planFile, approach), { deliverAs: "followUp" });
      return {
        content: [{ type: "text", text: "Approved. Implementation instructions were queued — plan mode is off." }],
        details: { planFile, approach },
      };
    },
  });

  // ── Command & shortcut ───────────────────────────────────────────────

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode: /plan [off | <first planning prompt>]",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim();
      if (text.toLowerCase() === "off") {
        if (!state.active) {
          notify(ctx, "Plan mode is not active.", "info");
          return;
        }
        leavePlanMode(ctx);
        return;
      }
      if (state.active && !text) {
        leavePlanMode(ctx);
        return;
      }
      enterPlanMode(ctx);
      if (text) {
        pi.sendUserMessage(text);
      }
    },
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Toggle plan mode",
    handler: async (ctx) => {
      if (state.active) {
        leavePlanMode(ctx as UiContext);
      } else {
        enterPlanMode(ctx as UiContext);
      }
    },
  });
}
