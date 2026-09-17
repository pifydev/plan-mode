import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyToolCall } from "../src/policy.ts";

const NO_APPROVALS = new Set<string>();

function verdict(toolName: string, input: unknown = {}) {
  return classifyToolCall({ toolName, input, planFile: null, approvedTools: NO_APPROVALS });
}

// ── agent_run (f195) ───────────────────────────────────────────────────

test("agent_run with a read-only agent confirms per call with a preview", () => {
  const v = verdict("agent_run", { agent: "scout", task: "map the auth module" });
  assert.equal(v.kind, "confirm");
  assert.equal((v as { perCall?: boolean }).perCall, true);
  assert.match((v as { reason: string }).reason, /agent=scout/);
  assert.match((v as { reason: string }).reason, /map the auth module/);
});

test("agent_run agent names are case-insensitive and trimmed", () => {
  assert.equal(verdict("agent_run", { agent: "  Reviewer  ", task: "x" }).kind, "confirm");
});

test("agent_run with a worker/custom/missing agent is blocked", () => {
  assert.equal(verdict("agent_run", { agent: "worker", task: "implement the plan" }).kind, "block");
  assert.equal(verdict("agent_run", { agent: "my-custom-agent", task: "x" }).kind, "block");
  assert.equal(verdict("agent_run", { task: "x" }).kind, "block");
  assert.equal(verdict("agent_run", {}).kind, "block");
});

test("agent_run with isolation set is blocked even for a read-only agent", () => {
  assert.equal(verdict("agent_run", { agent: "scout", task: "x", isolation: "worktree" }).kind, "block");
});

test("agent_run block reason steers toward scout/reviewer", () => {
  const v = verdict("agent_run", { agent: "worker", task: "x" });
  assert.match((v as { reason: string }).reason, /scout or reviewer/);
});

// ── swarm_run (f195) ───────────────────────────────────────────────────

test("swarm_run with a read-only top-level agent and string items confirms", () => {
  const v = verdict("swarm_run", { agent: "scout", items: ["read a", "read b"] });
  assert.equal(v.kind, "confirm");
  assert.equal((v as { perCall?: boolean }).perCall, true);
  assert.match((v as { reason: string }).reason, /2 item/);
  assert.match((v as { reason: string }).reason, /read a/);
});

test("swarm_run inspects each item's own agent", () => {
  const ok = verdict("swarm_run", { items: [{ task: "a", agent: "scout" }, { task: "b", agent: "reviewer" }] });
  assert.equal(ok.kind, "confirm");
  const bad = verdict("swarm_run", { items: [{ task: "a", agent: "scout" }, { task: "b", agent: "worker" }] });
  assert.equal(bad.kind, "block");
});

test("swarm_run blocks when an item has no agent and no top-level default (routing may pick worker)", () => {
  assert.equal(verdict("swarm_run", { items: ["do a thing"] }).kind, "block");
  assert.equal(verdict("swarm_run", { items: [{ task: "a" }] }).kind, "block");
});

test("swarm_run blocks a non-read-only top-level agent", () => {
  assert.equal(verdict("swarm_run", { agent: "worker", items: [{ task: "a", agent: "scout" }] }).kind, "block");
});

test("swarm_run blocks when isolation is set", () => {
  assert.equal(verdict("swarm_run", { agent: "scout", items: ["a"], isolation: "worktree" }).kind, "block");
});

test("swarm_run with no items is blocked (nothing to vouch for)", () => {
  assert.equal(verdict("swarm_run", { agent: "scout", items: [] }).kind, "block");
});

// ── workflow (f195) ────────────────────────────────────────────────────

test("workflow is always blocked in plan mode", () => {
  assert.equal(verdict("workflow", { script: "build.ts" }).kind, "block");
  assert.equal(verdict("workflow", { name: "release" }).kind, "block");
  assert.equal(verdict("workflow", { resumeFromRunId: "wf_123" }).kind, "block");
  assert.match((verdict("workflow", {}) as { reason: string }).reason, /resumeFromRunId/);
});

// ── delegation tools are never remembered by name ──────────────────────

test("an approved agent_run entry in approvedTools does not silently allow", () => {
  // Even if the tool name were remembered, delegation is judged per call.
  const v = classifyToolCall({
    toolName: "agent_run",
    input: { agent: "worker", task: "x" },
    planFile: null,
    approvedTools: new Set(["agent_run"]),
  });
  assert.equal(v.kind, "block");
});
