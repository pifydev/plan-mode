import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShellCommand, hasWritingRedirect, splitSegments } from "../src/shell.ts";

test("safe read-only commands run automatically", () => {
  for (const cmd of [
    "ls -la",
    "cat package.json",
    "grep -rn TODO src",
    "rg 'pattern' --type ts",
    "find . -name '*.ts'",
    "git status",
    "git log --oneline -5",
    "git diff HEAD~1",
    "wc -l src/index.ts",
    "cat a.md | grep x | sort | uniq",
  ]) {
    assert.deepEqual(classifyShellCommand(cmd), { kind: "allow" }, cmd);
  }
});

test("mutators are blocked outright", () => {
  for (const cmd of [
    "rm -rf node_modules",
    "mv a b",
    "touch new.txt",
    "mkdir dir",
    "npm install left-pad",
    "git commit -m x",
    "git push origin main",
    "git checkout -b feat",
    "sudo shutdown now",
    "curl -O https://example.com/file",
  ]) {
    assert.equal(classifyShellCommand(cmd).kind, "block", cmd);
  }
});

test("mutators hiding behind pipes and chains are still blocked", () => {
  assert.equal(classifyShellCommand("cat x | tee y").kind, "block");
  assert.equal(classifyShellCommand("ls && rm -rf /tmp/x").kind, "block");
  assert.equal(classifyShellCommand("git status; git push").kind, "block");
});

test("writing redirects are blocked; /dev/null and fd merges are fine", () => {
  assert.equal(classifyShellCommand("echo hi > file.txt").kind, "block");
  assert.equal(classifyShellCommand("cat a >> b").kind, "block");
  assert.deepEqual(classifyShellCommand("grep -r x . 2>/dev/null"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("node --version 2>&1"), { kind: "allow" });
  assert.ok(hasWritingRedirect("x > y"));
  assert.ok(!hasWritingRedirect("x 2>&1"));
  assert.ok(!hasWritingRedirect("x > /dev/null"));
});

test("unknown commands and unknown git subcommands need confirmation", () => {
  assert.equal(classifyShellCommand("terraform plan").kind, "confirm");
  assert.equal(classifyShellCommand("make build").kind, "confirm");
  assert.equal(classifyShellCommand("git bisect start").kind, "confirm");
});

test("inline interpreter code needs confirmation even for safe interpreters", () => {
  assert.equal(classifyShellCommand("node -e 'fs.writeFileSync(1)'").kind, "confirm");
  assert.equal(classifyShellCommand("python -c 'open(1)'").kind, "confirm");
  assert.deepEqual(classifyShellCommand("node --version"), { kind: "allow" });
});

test("env-var prefixes do not fool the classifier", () => {
  assert.equal(classifyShellCommand("FOO=1 rm -rf x").kind, "block");
  assert.deepEqual(classifyShellCommand("NO_COLOR=1 git status"), { kind: "allow" });
});

test("splitSegments handles operators", () => {
  assert.deepEqual(splitSegments("a && b | c ; d || e"), ["a", "b", "c", "d", "e"]);
});
