import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completeStep,
  formatSteps,
  mergeProgress,
  nextStep,
  parseSteps,
  progressLine,
  skippedBefore,
} from "../src/steps.ts";
import { escapeHtml, htmlPathFor, renderMarkdown, renderPlanHtml } from "../src/export.ts";
import { PLAN_STATE, replayBranch } from "../src/state.ts";

const PLAN = [
  "# Add rate limiting",
  "",
  "## Context",
  "- The API has no limits today",
  "",
  "## Steps",
  "1. Add a token-bucket module in src/limit.ts",
  "2. Wire it into the request middleware",
  "   1. keep the existing error shape",
  "3. Cover it with tests",
  "",
  "## Risks",
  "- Bucket sizing is a guess until we see traffic",
].join("\n");

test("parseSteps prefers numbered steps and ignores nested detail", () => {
  const steps = parseSteps(PLAN);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.index), [1, 2, 3]);
  assert.equal(steps[0]!.text, "Add a token-bucket module in src/limit.ts");
  assert.equal(steps[2]!.text, "Cover it with tests");
  assert.ok(steps.every((s) => !s.done));
});

test("parseSteps falls back to bullets under a steps heading", () => {
  const plan = [
    "# Plan",
    "## Background",
    "- not a step",
    "## Implementation steps",
    "- [ ] First thing",
    "- Second thing",
    "## Verification",
    "- also not a step",
  ].join("\n");
  const steps = parseSteps(plan);
  assert.deepEqual(steps.map((s) => s.text), ["First thing", "Second thing"]);
});

test("parseSteps returns nothing for a plan without a step list", () => {
  assert.deepEqual(parseSteps("# Plan\n\nJust prose about what to do."), []);
  assert.deepEqual(parseSteps(""), []);
});

test("completeStep enforces the obvious, allows the deliberate", () => {
  const steps = parseSteps(PLAN);
  const first = completeStep(steps, 1);
  assert.equal(first.error, null);
  assert.equal(first.steps[0]!.done, true);
  assert.equal(progressLine(first.steps), "1/3 steps");

  assert.ok(completeStep(first.steps, 1).error!.includes("already done"));
  assert.ok(completeStep(steps, 9).error!.includes("No step #9"));

  // out of order is allowed, but the skipped step is reported
  const jumped = completeStep(first.steps, 3);
  assert.equal(jumped.error, null);
  assert.deepEqual(skippedBefore(first.steps, 3).map((s) => s.index), [2]);
  assert.equal(nextStep(jumped.steps)!.index, 2);
});

test("nextStep and mergeProgress survive a re-parse of the plan", () => {
  const steps = parseSteps(PLAN);
  const done = completeStep(steps, 1).steps;
  // the plan file gained a step; progress on unchanged text is kept
  const reparsed = parseSteps(PLAN.replace("3. Cover it with tests", "3. Cover it with tests\n4. Document it"));
  const merged = mergeProgress(reparsed, done);
  assert.equal(merged.length, 4);
  assert.equal(merged[0]!.done, true);
  assert.equal(nextStep(merged)!.index, 2);
});

test("formatSteps marks done, current, and pending", () => {
  const steps = completeStep(parseSteps(PLAN), 1).steps;
  const text = formatSteps(steps);
  assert.ok(text.startsWith("1/3 steps"));
  assert.ok(text.includes("✔ 1."));
  assert.ok(text.includes("▸ 2."));
  assert.ok(text.includes("◻ 3."));
  assert.equal(formatSteps([]), "No steps parsed from the plan.");
});

test("replayBranch restores tracked steps and drops malformed ones", () => {
  const state = replayBranch([
    {
      type: "custom",
      customType: PLAN_STATE,
      data: {
        active: false,
        planFile: "/p.md",
        buildThinking: null,
        enteredAt: 1,
        steps: [
          { index: 1, text: "a", done: true },
          { index: 2, text: "b" },
          { text: "no index" },
          "junk",
        ],
      },
    },
  ]);
  assert.equal(state.steps.length, 2);
  assert.equal(state.steps[0]!.done, true);
  assert.equal(state.steps[1]!.done, false);
});

test("escapeHtml neutralizes markup before anything else runs", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  const html = renderPlanHtml("# <img src=x onerror=alert(1)>", { title: "t", generatedAt: "now" });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("renderMarkdown covers the subset plans are written in", () => {
  const html = renderMarkdown(
    ["# Title", "", "Some **bold** and `code`.", "", "1. one", "2. two", "", "- [x] done", "- [ ] open", "", "```js", "const a = 1 < 2;", "```"].join("\n"),
  );
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ol>\n<li>one</li>"));
  assert.ok(html.includes('<li class="done">done</li>'));
  assert.ok(html.includes("<li>open</li>"));
  assert.ok(html.includes("<pre><code>\nconst a = 1 &lt; 2;"));
  // lists close before the next block
  assert.ok(html.includes("</ol>"));
  assert.ok(html.includes("</ul>"));
});

test("renderPlanHtml is self-contained and carries the footer", () => {
  const html = renderPlanHtml("# Plan\n\n1. step", {
    title: "add rate limiting",
    generatedAt: "2026-09-06 12:00",
    sourceFile: "2026-09-06-add-rate-limiting.md",
    progress: "1/3 steps",
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<title>add rate limiting</title>"));
  assert.ok(html.includes("<style>"));
  assert.ok(!html.includes("http://") && !html.includes("https://"));
  assert.ok(html.includes("1/3 steps"));
  assert.ok(html.includes("2026-09-06-add-rate-limiting.md"));
});

test("htmlPathFor sits next to the plan", () => {
  assert.equal(htmlPathFor("/a/.pi/plans/2026-09-06-x.md"), "/a/.pi/plans/2026-09-06-x.html");
  assert.equal(htmlPathFor("plan"), "plan.html");
});
