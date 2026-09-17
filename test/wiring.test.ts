import { test } from "node:test";
import assert from "node:assert/strict";
import planMode from "../extensions/plan-mode.ts";
import { PLAN_STATE } from "../src/state.ts";

/**
 * Drive the real extension against a stub pi/ctx so the tool_call, session_start
 * and /plan command wiring is exercised end to end — not just the pure policy.
 */
type Handler = (event: unknown, ctx: unknown) => unknown;

interface HarnessOpts {
  flags?: Record<string, unknown>;
  branch?: unknown[];
}

function makeHarness(opts: HarnessOpts = {}) {
  const handlers: Record<string, Handler> = {};
  const commands: Record<string, { handler: (args: string, ctx: unknown) => unknown }> = {};
  const calls = {
    appendEntry: [] as Array<{ type: string; data: unknown }>,
    sendUserMessage: [] as Array<{ text: string; options?: unknown }>,
    sendMessage: [] as unknown[],
    setStatus: [] as Array<{ key: string; value: unknown }>,
    confirmCount: 0,
  };
  // Mutable so a test can decide each dialog's answer.
  const ui = {
    confirmResult: true,
    setStatus: (key: string, value: unknown) => calls.setStatus.push({ key, value }),
    notify: () => {},
    confirm: async () => { calls.confirmCount++; return ui.confirmResult; },
    select: async () => undefined,
    input: async () => undefined,
  };
  let thinking = "medium";
  const pi = {
    on: (name: string, fn: Handler) => { handlers[name] = fn; },
    appendEntry: (type: string, data: unknown) => calls.appendEntry.push({ type, data }),
    getThinkingLevel: () => thinking,
    setThinkingLevel: (level: string) => { thinking = level; },
    sendMessage: (m: unknown) => calls.sendMessage.push(m),
    sendUserMessage: (text: string, options?: unknown) => calls.sendUserMessage.push({ text, options }),
    getFlag: (name: string) => opts.flags?.[name],
    registerFlag: () => {},
    registerTool: () => {},
    registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => unknown }) => { commands[name] = def; },
    registerShortcut: () => {},
  };
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: { getBranch: () => opts.branch ?? [] },
    ui,
  };
  planMode(pi as never);
  return { handlers, commands, calls, ctx, ui };
}

test("f195: an approved scout agent_run does NOT approve a later worker call", async () => {
  const h = makeHarness({ flags: { plan: true } });
  // Enter plan mode via a genuine startup.
  await h.handlers.session_start!({ reason: "startup" }, h.ctx);

  const toolCall = h.handlers.tool_call!;
  // 1. agent_run agent=scout: confirm dialog shown, user approves -> allowed.
  const scout = await toolCall({ toolName: "agent_run", input: { agent: "scout", task: "map auth" } }, h.ctx);
  assert.equal(scout, undefined, "scout run allowed after confirm");
  assert.equal(h.calls.confirmCount, 1, "scout run asked once");

  // 2. agent_run agent=worker: must be blocked outright, NOT silently allowed.
  const worker = await toolCall({ toolName: "agent_run", input: { agent: "worker", task: "implement" } }, h.ctx);
  assert.equal((worker as { block?: boolean })?.block, true, "worker run is blocked");
  assert.equal(h.calls.confirmCount, 1, "worker run did not even prompt");

  // 3. a second scout run confirms AGAIN (per-call, never remembered by name).
  await toolCall({ toolName: "agent_run", input: { agent: "scout", task: "look again" } }, h.ctx);
  assert.equal(h.calls.confirmCount, 2, "second scout run asks again");
});

test("f195: workflow is blocked even after a prior custom-tool approval", async () => {
  const h = makeHarness({ flags: { plan: true } });
  await h.handlers.session_start!({ reason: "startup" }, h.ctx);
  const toolCall = h.handlers.tool_call!;
  // Approve some unrelated custom tool so approvedTools is non-empty.
  await toolCall({ toolName: "some_mcp_tool", input: {} }, h.ctx);
  const wf = await toolCall({ toolName: "workflow", input: { script: "deploy.ts" } }, h.ctx);
  assert.equal((wf as { block?: boolean })?.block, true);
});

test("f081: /plan <prompt> queues the prompt as a followUp (survives mid-stream)", async () => {
  const h = makeHarness();
  await h.handlers.session_start!({ reason: "startup" }, h.ctx);
  await h.commands.plan!.handler("rethink the caching layer first", h.ctx);
  const last = h.calls.sendUserMessage.at(-1);
  assert.equal(last?.text, "rethink the caching layer first");
  assert.deepEqual(last?.options, { deliverAs: "followUp" });
});

test("f082: session_start reason 'reload' preserves tracked steps (no re-enter)", async () => {
  // A post-approval snapshot: not active, but tracking two steps.
  const snapshot = {
    active: false,
    planFile: null,
    buildThinking: null,
    enteredAt: null,
    steps: [
      { index: 1, text: "one", done: true },
      { index: 2, text: "two", done: false },
    ],
  };
  const branch = [{ type: "custom", customType: PLAN_STATE, data: snapshot }];
  const h = makeHarness({ flags: { plan: true }, branch });

  await h.handlers.session_start!({ reason: "reload" }, h.ctx);

  // Re-entering would commit a fresh {active:true, steps:[]} snapshot; it must not.
  const reentered = h.calls.appendEntry.some(
    (e) => e.type === PLAN_STATE && (e.data as { active?: boolean }).active === true,
  );
  assert.equal(reentered, false, "did not re-enter plan mode on reload");
  // The badge follows the preserved open step, not the '📋 plan' active badge.
  const badge = h.calls.setStatus.at(-1);
  assert.equal(badge?.key, "plan");
  assert.match(String(badge?.value), /1\/2|2/);
});

test("f082: session_start reason 'startup' still auto-enters with --plan", async () => {
  const h = makeHarness({ flags: { plan: true } });
  await h.handlers.session_start!({ reason: "startup" }, h.ctx);
  const entered = h.calls.appendEntry.some(
    (e) => e.type === PLAN_STATE && (e.data as { active?: boolean }).active === true,
  );
  assert.equal(entered, true);
});
