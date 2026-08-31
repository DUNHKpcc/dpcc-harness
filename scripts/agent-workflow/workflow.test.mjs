import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 120_000,
  });
}

function temporaryState(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-workflow-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("Pi reference pins all shipped sources and passes 30-scenario Recall@5", () => {
  const check = run(process.execPath, ["scripts/agent-workflow/pi-reference.mjs", "check", "--json"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const contract = JSON.parse(check.stdout);
  assert.equal(contract.sources.length, 3);
  assert.equal(contract.scenarios, 30);

  const benchmark = run(process.execPath, ["scripts/agent-workflow/pi-reference.mjs", "benchmark", "--json"]);
  assert.equal(benchmark.status, 0, benchmark.stderr || benchmark.stdout);
  const result = JSON.parse(benchmark.stdout);
  assert.equal(result.total, 30);
  assert.equal(result.passed, 30);
  assert.ok(result.recallAt5 >= 0.9);
});

test("Pi reference query returns app, pinned source, and official documentation paths", () => {
  const query = run(process.execPath, [
    "scripts/agent-workflow/pi-reference.mjs",
    "--",
    "query",
    "Electron restart recovery cannot attach an absent ACP runtime",
    "--json",
  ]);
  assert.equal(query.status, 0, query.stderr || query.stdout);
  const result = JSON.parse(query.stdout);
  assert.equal(result.results[0].id, "recovery");
  assert.ok(result.results[0].appPaths.includes("electron/src/lib/e2e/acp-recovery-harness.ts"));
  assert.ok(result.results[0].sourcePaths.some((file) => file.includes("pi-acp")));
  assert.ok(result.results[0].officialDocs.some((url) => url.startsWith("https://pi.dev/")));
});

test("workflow evidence isolates runs and records exit code, HEAD, and dirty hash", (t) => {
  const state = temporaryState(t);
  const env = { HARNSS_WORKFLOW_STATE_DIR: state };
  const first = run(process.execPath, ["scripts/agent-workflow/evidence.mjs", "start", "first"], { env });
  assert.equal(first.status, 0, first.stderr);
  const firstRun = first.stdout.trim();
  const record = run(
    process.execPath,
    ["scripts/agent-workflow/evidence.mjs", "record", "gate", "unit", "7", "intentional failure"],
    { env },
  );
  assert.equal(record.status, 0, record.stderr);

  const second = run(process.execPath, ["scripts/agent-workflow/evidence.mjs", "start", "second"], { env });
  assert.equal(second.status, 0, second.stderr);
  const secondRun = second.stdout.trim();
  assert.notEqual(secondRun, firstRun);

  const report = run(process.execPath, ["scripts/agent-workflow/evidence.mjs", "report", "--json"], { env });
  assert.equal(report.status, 0, report.stderr);
  const current = JSON.parse(report.stdout);
  assert.equal(current.metadata.runId, secondRun);
  assert.equal(current.events.some((event) => event.summary === "intentional failure"), false);
  assert.match(current.metadata.headSha, /^[0-9a-f]{40}$/);
  assert.match(current.metadata.dirtyHash, /^[0-9a-f]{64}$/);

  const firstEvents = fs
    .readFileSync(path.join(state, "runs", firstRun, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(firstEvents.at(-1).exitCode, 7);
  assert.match(firstEvents.at(-1).headSha, /^[0-9a-f]{40}$/);
  assert.match(firstEvents.at(-1).dirtyHash, /^[0-9a-f]{64}$/);
});

test("review is fail-closed when any selected gate fails", (t) => {
  const state = temporaryState(t);
  const result = run("bash", ["scripts/agent-workflow/review.sh", "--fast"], {
    env: {
      HARNSS_WORKFLOW_STATE_DIR: state,
      WORKFLOW_NO_TEE: "1",
      WORKFLOW_SELF_TEST: "1",
      WORKFLOW_GATE_FILTER: "pi-reference",
      WORKFLOW_FAIL_GATE: "pi-reference",
    },
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pi-reference failed with exit code 97/);
  assert.doesNotMatch(result.stdout, /failed.*\n.*exit 0/);
  const runId = fs.readFileSync(path.join(state, "current-run-id"), "utf8").trim();
  const metadata = JSON.parse(fs.readFileSync(path.join(state, "runs", runId, "metadata.json"), "utf8"));
  assert.equal(metadata.status, "failed");
});

test("review passes a successful selected gate and never packages in local full mode", (t) => {
  const state = temporaryState(t);
  const selected = run("bash", ["scripts/agent-workflow/review.sh", "--fast"], {
    env: {
      HARNSS_WORKFLOW_STATE_DIR: state,
      WORKFLOW_NO_TEE: "1",
      WORKFLOW_SELF_TEST: "1",
      WORKFLOW_GATE_FILTER: "pi-reference",
    },
  });
  assert.equal(selected.status, 0, selected.stdout + selected.stderr);
  const runId = fs.readFileSync(path.join(state, "current-run-id"), "utf8").trim();
  const metadata = JSON.parse(fs.readFileSync(path.join(state, "runs", runId, "metadata.json"), "utf8"));
  assert.equal(metadata.status, "passed");

  const gates = run("bash", ["scripts/agent-workflow/review.sh", "--full", "--list-gates"], {
    env: { HARNSS_WORKFLOW_STATE_DIR: state, WORKFLOW_NO_TEE: "1" },
  });
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /pi-integration/);
  assert.match(gates.stdout, /electron-recovery/);
  assert.doesNotMatch(gates.stdout, /package-linux|package-smoke|ui-e2e/);

  const ciOutsideActions = run("bash", ["scripts/agent-workflow/review.sh", "--ci"], {
    env: {
      GITHUB_ACTIONS: "false",
      HARNSS_WORKFLOW_STATE_DIR: state,
      WORKFLOW_NO_TEE: "1",
    },
  });
  assert.notEqual(ciOutsideActions.status, 0);
  assert.match(ciOutsideActions.stdout, /restricted to GitHub Actions on Linux/);
});

test("local full review uses an isolated Pi provider fixture", (t) => {
  const state = temporaryState(t);
  const result = run("bash", ["scripts/agent-workflow/review.sh", "--full"], {
    env: {
      HARNSS_WORKFLOW_STATE_DIR: state,
      WORKFLOW_NO_TEE: "1",
      WORKFLOW_SELF_TEST: "1",
      WORKFLOW_GATE_FILTER: "pi-runtime",
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Pi runtime doctor: OK/);
  assert.match(result.stdout, /mode=full executed=1 passed=1 failed=0/);
});

test("review rejects gate filtering outside workflow self-tests", (t) => {
  const result = run("bash", ["scripts/agent-workflow/review.sh", "--fast"], {
    env: {
      HARNSS_WORKFLOW_STATE_DIR: temporaryState(t),
      WORKFLOW_NO_TEE: "1",
      WORKFLOW_GATE_FILTER: "pi-reference",
    },
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /restricted to workflow self-tests/);
});

test("Semgrep is fail-closed locally and in the PR quality workflow", () => {
  const review = fs.readFileSync(path.join(root, "scripts/agent-workflow/review.sh"), "utf8");
  const quality = fs.readFileSync(path.join(root, ".github/workflows/quality.yml"), "utf8");
  assert.match(review, /run_semgrep\(\) \(/);
  assert.match(review, /semgrep scan --metrics=off --error --config \.semgrep\.yml/);
  assert.match(quality, /semgrep==1\.168\.0/);
  assert.match(quality, /semgrep scan --metrics=off --error --config \.semgrep\.yml/);
});

test("doctor and start fail closed when required tools are unavailable", (t) => {
  const state = temporaryState(t);
  const env = {
    HOME: state,
    PATH: "/usr/bin:/bin",
    HARNSS_WORKFLOW_STATE_DIR: state,
    WORKFLOW_NO_TEE: "1",
  };
  const doctor = run("/bin/bash", ["scripts/agent-workflow/doctor.sh"], { env });
  assert.notEqual(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /required item\(s\) failed/);

  const start = run("/bin/bash", ["scripts/agent-workflow/start.sh"], { env });
  assert.notEqual(start.status, 0, start.stdout + start.stderr);
  assert.doesNotMatch(start.stdout, /Workflow ready/);
});

test("all workflow package commands resolve to unignored repository files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const commands = Object.entries(pkg.scripts).filter(([name]) => name.startsWith("workflow:"));
  assert.ok(commands.length >= 13);

  for (const [name, command] of commands) {
    const targets = command.match(/scripts\/agent-workflow\/[A-Za-z0-9._/-]+/g) || [];
    assert.ok(targets.length > 0, `${name} has no repository target`);
    for (const target of targets) {
      assert.equal(fs.existsSync(path.join(root, target)), true, `${name} target is missing: ${target}`);
      const ignored = run("git", ["check-ignore", "-q", target]);
      assert.notEqual(ignored.status, 0, `${name} target is ignored: ${target}`);
    }
  }
});

test("all workflow shell scripts pass bash syntax validation", () => {
  const directory = path.join(root, "scripts/agent-workflow");
  const scripts = fs.readdirSync(directory).filter((file) => file.endsWith(".sh"));
  assert.ok(scripts.length >= 9);
  for (const script of scripts) {
    const result = run("bash", ["-n", path.join("scripts/agent-workflow", script)]);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("all workflow Node modules pass syntax validation", () => {
  const directory = path.join(root, "scripts/agent-workflow");
  const scripts = fs.readdirSync(directory).filter((file) => file.endsWith(".mjs"));
  assert.ok(scripts.length >= 3);
  for (const script of scripts) {
    const result = run(process.execPath, ["--check", path.join("scripts/agent-workflow", script)]);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("workflow repository files do not contain trailing whitespace", () => {
  const files = [
    ".semgrep.yml",
    ".serena/project.yml",
    ".agents/skills/harnss-agent-workflow/SKILL.md",
    ".agents/skills/harnss-agent-workflow/agents/openai.yaml",
    ".agents/skills/harnss-agent-workflow/scripts/start.sh",
    ...fs.readdirSync(path.join(root, "scripts/agent-workflow")).map((file) => `scripts/agent-workflow/${file}`),
  ];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => assert.doesNotMatch(line, /[ \t]+$/, `${file}:${index + 1}`));
  }
});

test("status emits Markdown literally without executing backticks", (t) => {
  const state = temporaryState(t);
  const result = run("bash", ["scripts/agent-workflow/status.sh"], {
    env: { HARNSS_WORKFLOW_STATE_DIR: state },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /- Generated: `[^`]+`/);
  assert.match(result.stdout, /- `node`: `[^`]+`/);
  assert.match(result.stdout, /Run `pnpm workflow:review -- --full`/);
});

test("handoff reports current evidence and only references real evidence files", (t) => {
  const state = temporaryState(t);
  const env = { HARNSS_WORKFLOW_STATE_DIR: state, WORKFLOW_NO_TEE: "1" };
  const start = run(process.execPath, ["scripts/agent-workflow/evidence.mjs", "start", "handoff test"], { env });
  assert.equal(start.status, 0, start.stderr);
  const report = run(process.execPath, ["scripts/agent-workflow/evidence.mjs", "report", "--json"], { env });
  assert.equal(report.status, 0, report.stderr);
  const current = JSON.parse(report.stdout).current;

  const handoff = run(
    "bash",
    ["scripts/agent-workflow/handoff.sh", "--to", "next", "--summary", "summary", "--next", "continue"],
    { env },
  );
  assert.equal(handoff.status, 0, handoff.stdout + handoff.stderr);
  const markdown = fs.readFileSync(path.join(state, "latest-handoff.md"), "utf8");
  assert.ok(markdown.includes("Run HEAD: `" + current.headSha + "`"));
  assert.ok(markdown.includes("Run dirty hash: `" + current.dirtyHash + "`"));
  assert.match(markdown, /Current run metadata:/);
  assert.match(markdown, /Current run events:/);
  assert.doesNotMatch(markdown, /latest-serena-calls|latest-code-review-graph/);
});

test("stop cleans stale owned metadata and refuses legacy PID records", (t) => {
  const state = temporaryState(t);
  const pidFile = path.join(state, "serena.pid");
  const metaFile = path.join(state, "serena-process.json");
  fs.writeFileSync(pidFile, "999999\n");
  fs.writeFileSync(metaFile, JSON.stringify({
    pid: 999999,
    root,
    purpose: "explicit-http-debug",
  }));
  const stale = run("bash", ["scripts/agent-workflow/stop.sh"], {
    env: { HARNSS_WORKFLOW_STATE_DIR: state },
  });
  assert.equal(stale.status, 0, stale.stdout + stale.stderr);
  assert.match(stale.stdout, /Removed stale metadata/);
  assert.equal(fs.existsSync(pidFile), false);
  assert.equal(fs.existsSync(metaFile), false);

  fs.writeFileSync(pidFile, "999999\n");
  const legacy = run("bash", ["scripts/agent-workflow/stop.sh"], {
    env: { HARNSS_WORKFLOW_STATE_DIR: state },
  });
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stdout, /unverified legacy PID/);
});

test("subagent ownership is canonical, repository-bounded, and rejects Spark", (t) => {
  const state = temporaryState(t);
  const env = { HARNSS_WORKFLOW_STATE_DIR: state };
  const canonical = run(
    "bash",
    [
      "scripts/agent-workflow/subagent.sh",
      "assign",
      "project-coder",
      "--model",
      "project_coder_medium",
      "--agent-id",
      "agent-123",
      "--owns",
      "src/./hooks/../hooks/session/",
      "--task",
      "focused test work",
    ],
    { env },
  );
  assert.equal(canonical.status, 0, canonical.stdout + canonical.stderr);
  const ledger = fs.readFileSync(path.join(state, "subagent-assignments.tsv"), "utf8");
  assert.match(ledger, /src\/hooks\/session/);
  assert.match(ledger, /model=project_coder_medium;agentId=agent-123/);

  const escape = run(
    "bash",
    ["scripts/agent-workflow/subagent.sh", "assign", "escape", "--owns", "../outside", "--task", "escape"],
    { env: { HARNSS_WORKFLOW_STATE_DIR: temporaryState(t) } },
  );
  assert.notEqual(escape.status, 0);
  assert.match(escape.stderr, /escapes repository/);

  const spark = run(
    "bash",
    ["scripts/agent-workflow/subagent.sh", "assign", "spark_executor", "--owns", "src", "--task", "work"],
    { env: { HARNSS_WORKFLOW_STATE_DIR: temporaryState(t) } },
  );
  assert.notEqual(spark.status, 0);
  assert.match(spark.stdout, /Spark delegation is prohibited/);

  const controlCharacter = run(
    "bash",
    ["scripts/agent-workflow/subagent.sh", "assign", "bad\tname", "--owns", "src", "--task", "work"],
    { env: { HARNSS_WORKFLOW_STATE_DIR: temporaryState(t) } },
  );
  assert.notEqual(controlCharacter.status, 0);
  assert.match(controlCharacter.stdout, /must not contain tabs or newlines/);

  const symlinkRoot = path.join(root, ".harnss", "agent-workflow", `path-test-${process.pid}-${Date.now()}`);
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-workflow-outside-"));
  fs.mkdirSync(symlinkRoot, { recursive: true });
  fs.symlinkSync(outsideRoot, path.join(symlinkRoot, "outside"), "dir");
  t.after(() => {
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });
  const symlinkEscape = run(
    "bash",
    [
      "scripts/agent-workflow/subagent.sh",
      "assign",
      "escape-symlink",
      "--owns",
      path.relative(root, path.join(symlinkRoot, "outside", "new-file.ts")),
      "--task",
      "escape",
    ],
    { env: { HARNSS_WORKFLOW_STATE_DIR: temporaryState(t) } },
  );
  assert.notEqual(symlinkEscape.status, 0);
  assert.match(symlinkEscape.stderr, /escapes repository/);
});

test("subagent assignment recovers a stale lock", (t) => {
  const state = temporaryState(t);
  const lock = path.join(state, "subagent-assignments.lock");
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, "pid"), "999999\n");
  fs.writeFileSync(path.join(lock, "started"), "0\n");
  const result = run(
    "bash",
    ["scripts/agent-workflow/subagent.sh", "assign", "reviewer", "--owns", "readonly:src", "--task", "review"],
    { env: { HARNSS_WORKFLOW_STATE_DIR: state } },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(lock), false);
});
