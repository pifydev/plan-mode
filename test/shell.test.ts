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

test("splitSegments also breaks on newlines, CR and standalone '&'", () => {
  assert.deepEqual(splitSegments("ls\nrm -rf x"), ["ls", "rm -rf x"]);
  assert.deepEqual(splitSegments("ls\r\nrm -rf x"), ["ls", "rm -rf x"]);
  assert.deepEqual(splitSegments("ls & rm -rf x"), ["ls", "rm -rf x"]);
  // "&&" must still win over a lone "&", and fd merges must not be split.
  assert.deepEqual(splitSegments("a && b"), ["a", "b"]);
  assert.deepEqual(splitSegments("node --version 2>&1"), ["node --version 2>&1"]);
});

test("mutators after a newline are blocked (not masked by first segment)", () => {
  assert.equal(classifyShellCommand("ls\nrm -rf x").kind, "block");
  assert.equal(classifyShellCommand("cat a.md\r\ntouch b").kind, "block");
});

test("mutators after a standalone '&' (background) are blocked", () => {
  assert.equal(classifyShellCommand("ls & rm -rf x").kind, "block");
  assert.equal(classifyShellCommand("cat foo & npm install").kind, "block");
});

test("command/process substitution needs confirmation, not allow", () => {
  assert.equal(classifyShellCommand("echo $(rm -rf x)").kind, "confirm");
  assert.equal(classifyShellCommand("cat `rm -rf x`").kind, "confirm");
  assert.equal(classifyShellCommand("diff <(cat a) <(rm b)").kind, "confirm");
  assert.equal(classifyShellCommand("git status $(rm -rf x)").kind, "confirm");
  // A mutator that also uses substitution stays blocked (stricter wins).
  assert.equal(classifyShellCommand("rm $(echo x)").kind, "block");
});

test("find with destructive actions needs confirmation", () => {
  assert.equal(classifyShellCommand("find . -name '*.log' -delete").kind, "confirm");
  assert.equal(classifyShellCommand("find . -exec rm {} ;").kind, "confirm");
  assert.equal(classifyShellCommand("find . -execdir rm {} ;").kind, "confirm");
  // Plain read-only find still runs automatically.
  assert.deepEqual(classifyShellCommand("find . -name '*.ts'"), { kind: "allow" });
});

test("git branch/tag/remote: read-only forms allow, mutating forms confirm", () => {
  // read-only / listing forms
  assert.deepEqual(classifyShellCommand("git branch"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("git branch -a"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("git branch --list 'feat*'"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("git tag"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("git tag -l"), { kind: "allow" });
  assert.deepEqual(classifyShellCommand("git remote -v"), { kind: "allow" });
  // mutating forms
  assert.equal(classifyShellCommand("git branch -D feat").kind, "confirm");
  assert.equal(classifyShellCommand("git branch -m old new").kind, "confirm");
  assert.equal(classifyShellCommand("git branch newbranch").kind, "confirm");
  assert.equal(classifyShellCommand("git tag v1.0.0").kind, "confirm");
  assert.equal(classifyShellCommand("git tag -d v1.0.0").kind, "confirm");
  assert.equal(classifyShellCommand("git remote add origin url").kind, "confirm");
  assert.equal(classifyShellCommand("git remote set-url origin url").kind, "confirm");
});

test("interpreter -m module invocations need confirmation", () => {
  assert.equal(classifyShellCommand("python -m pip install requests").kind, "confirm");
  assert.equal(classifyShellCommand("python3 -m venv .venv").kind, "confirm");
  assert.equal(classifyShellCommand("node -e 'x'").kind, "confirm");
  // -m only flags the safe interpreters; a bare version check still allows.
  assert.deepEqual(classifyShellCommand("python --version"), { kind: "allow" });
});
