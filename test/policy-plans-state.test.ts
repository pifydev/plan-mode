import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyToolCall } from "../src/policy.ts";
import { createPlanFile, slugify } from "../src/plans.ts";
import { PLAN_STATE, replayBranch } from "../src/state.ts";
import { INITIAL_STATE } from "../src/types.ts";

const NO_APPROVALS = new Set<string>();

function verdict(toolName: string, input: unknown = {}, planFile: string | null = null) {
  return classifyToolCall({ toolName, input, planFile, approvedTools: NO_APPROVALS });
}

test("read-only builtins are allowed", () => {
  for (const tool of ["read", "grep", "find", "ls"]) {
    assert.deepEqual(verdict(tool), { kind: "allow" }, tool);
  }
});

test("edit/write blocked except on the current plan file", () => {
  assert.equal(verdict("edit", { path: "src/app.ts" }).kind, "block");
  assert.equal(verdict("write", { path: "x.md" }, null).kind, "block");
  const plan = resolve(".pi/plans/2026-09-04-x.md");
  assert.deepEqual(verdict("edit", { path: plan }, plan), { kind: "allow" });
  // case/slash-insensitive on the same path
  assert.deepEqual(verdict("write", { path: plan.replaceAll("\\", "/") }, plan), { kind: "allow" });
  assert.equal(verdict("edit", { path: resolve(".pi/plans/other.md") }, plan).kind, "block");
});

test("bash delegates to the shell classifier", () => {
  assert.deepEqual(verdict("bash", { command: "git status" }), { kind: "allow" });
  assert.equal(verdict("bash", { command: "rm -rf x" }).kind, "block");
  assert.equal(verdict("bash", { command: "make test" }).kind, "confirm");
  assert.equal(verdict("bash", {}).kind, "block");
});

test("powershell is blocked; suite read-only tools and plan tools allowed", () => {
  assert.equal(verdict("powershell", { script: "ls" }).kind, "block");
  for (const tool of ["memory_read", "memory_search", "goal_status", "write_plan", "exit_plan_mode"]) {
    assert.deepEqual(verdict(tool), { kind: "allow" }, tool);
  }
});

test("unknown custom tools confirm; approved ones pass", () => {
  assert.equal(verdict("some_mcp_tool").kind, "confirm");
  const approved = classifyToolCall({
    toolName: "some_mcp_tool",
    input: {},
    planFile: null,
    approvedTools: new Set(["some_mcp_tool"]),
  });
  assert.deepEqual(approved, { kind: "allow" });
});

test("slugify normalizes titles", () => {
  assert.equal(slugify("Add OAuth2 login!"), "add-oauth2-login");
  assert.equal(slugify("  Tiếng Việt plan  "), "tieng-viet-plan");
  assert.equal(slugify("???"), "plan");
});

test("createPlanFile writes and uniquifies", () => {
  const base = mkdtempSync(join(tmpdir(), "pify-plan-"));
  try {
    const f1 = createPlanFile(base, "My Plan", "# Plan\ncontent");
    const f2 = createPlanFile(base, "My Plan", "# Plan 2");
    assert.notEqual(f1, f2);
    assert.ok(readFileSync(f1, "utf8").endsWith("\n"));
    assert.ok(f1.replaceAll("\\", "/").includes("/.pi/plans/"));
    assert.match(f1, /\d{4}-\d{2}-\d{2}-my-plan\.md$/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("replayBranch: last snapshot wins, junk skipped", () => {
  assert.deepEqual(replayBranch([]), INITIAL_STATE);
  const active = { active: true, planFile: "/p.md", buildThinking: "medium", enteredAt: 5 };
  const state = replayBranch([
    { type: "custom", customType: PLAN_STATE, data: active },
    { type: "custom", customType: PLAN_STATE, data: { bogus: 1 } },
    { type: "custom", customType: "other", data: { active: false } },
  ]);
  assert.equal(state.active, true);
  assert.equal(state.planFile, "/p.md");
  const off = replayBranch([
    { type: "custom", customType: PLAN_STATE, data: active },
    { type: "custom", customType: PLAN_STATE, data: { ...INITIAL_STATE } },
  ]);
  assert.equal(off.active, false);
});

test("v0.2 listPlanFiles lists newest-first, empty when absent", () => {
  const base = mkdtempSync(join(tmpdir(), "pify-planlist-"));
  try {
    const { listPlanFiles, createPlanFile } = require("../src/plans.ts") as typeof import("../src/plans.ts");
    assert.deepEqual(listPlanFiles(base), []);
    createPlanFile(base, "Alpha", "# a");
    createPlanFile(base, "Beta", "# longer content here");
    const plans = listPlanFiles(base);
    assert.equal(plans.length, 2);
    assert.ok(plans.every((p) => p.file.endsWith(".md")));
    assert.ok(plans.every((p) => p.size > 0));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
