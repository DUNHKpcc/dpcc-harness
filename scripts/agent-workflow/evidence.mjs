#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.HARNSS_WORKFLOW_ROOT || path.join(scriptDir, "../.."));
const stateDir = path.resolve(
  process.env.HARNSS_WORKFLOW_STATE_DIR || path.join(root, ".harnss/agent-workflow"),
);
const runsDir = path.join(stateDir, "runs");
const currentRunFile = path.join(stateDir, "current-run-id");

function git(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function utcNow() {
  return new Date().toISOString();
}

function currentState() {
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], "");
  const diff = git(["diff", "--binary", "HEAD", "--"], "");
  const hash = createHash("sha256");
  hash.update(status);
  hash.update("\0");
  hash.update(diff);

  const rawEntries = status.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    entries.push(entry);
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  for (const entry of entries) {
    if (!entry.startsWith("?? ")) continue;
    const file = path.resolve(root, entry.slice(3));
    if (!file.startsWith(`${root}${path.sep}`)) continue;
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if (stat.isFile()) hash.update(fs.readFileSync(file));
    } catch {
      // The status line remains part of the hash when a file disappears mid-read.
    }
  }

  return {
    branch: git(["branch", "--show-current"]),
    headSha: git(["rev-parse", "HEAD"]),
    dirtyHash: hash.digest("hex"),
    changedFiles: entries.length,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCurrentRunId() {
  try {
    return fs.readFileSync(currentRunFile, "utf8").trim();
  } catch {
    return "";
  }
}

function runPaths(runId) {
  const runDir = path.join(runsDir, runId);
  return {
    runDir,
    metadata: path.join(runDir, "metadata.json"),
    events: path.join(runDir, "events.jsonl"),
  };
}

function startRun(summary) {
  fs.mkdirSync(runsDir, { recursive: true });
  const runId = `${utcNow().replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const state = currentState();
  const metadata = {
    schemaVersion: 1,
    runId,
    mode: "codex-led",
    startedAt: utcNow(),
    completedAt: null,
    status: "active",
    summary,
    root,
    ...state,
  };
  const files = runPaths(runId);
  fs.mkdirSync(files.runDir, { recursive: true });
  writeJson(files.metadata, metadata);
  fs.writeFileSync(currentRunFile, `${runId}\n`, { mode: 0o600 });
  recordEvent(runId, "session-start", "codex-led", 0, summary || "Workflow run started");
  return runId;
}

function requireRun() {
  const existing = readCurrentRunId();
  if (existing && fs.existsSync(runPaths(existing).metadata)) return existing;
  return startRun("Automatically created for workflow evidence");
}

function recordEvent(runId, event, subject, exitCode, summary) {
  const files = runPaths(runId);
  const state = currentState();
  const record = {
    schemaVersion: 1,
    runId,
    timestamp: utcNow(),
    event,
    subject,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    summary,
    ...state,
  };
  fs.mkdirSync(files.runDir, { recursive: true });
  fs.appendFileSync(files.events, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

function readEvents(runId) {
  const file = runPaths(runId).events;
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function finishRun(status, summary) {
  const runId = requireRun();
  recordEvent(runId, "run-finish", status, status === "passed" ? 0 : 1, summary);
  const files = runPaths(runId);
  const metadata = readJson(files.metadata);
  writeJson(files.metadata, {
    ...metadata,
    completedAt: utcNow(),
    status,
    finalSummary: summary,
    finalState: currentState(),
  });
  return runId;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function printReport(runId, json) {
  const files = runPaths(runId);
  const metadata = readJson(files.metadata);
  const events = readEvents(runId);
  const current = currentState();
  const gates = events.filter((event) => event.event === "gate");
  const failedGates = gates.filter((event) => event.exitCode !== 0);
  const report = { metadata, current, events, gates: { total: gates.length, failed: failedGates.length } };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  console.log("## Current Run Evidence\n");
  console.log(`- Run ID: \`${metadata.runId}\``);
  console.log(`- Status: \`${metadata.status}\``);
  console.log(`- Started: \`${metadata.startedAt}\``);
  console.log(`- Start HEAD: \`${metadata.headSha}\``);
  console.log(`- Current HEAD: \`${current.headSha}\``);
  console.log(`- Start dirty hash: \`${metadata.dirtyHash}\``);
  console.log(`- Current dirty hash: \`${current.dirtyHash}\``);
  console.log(`- Current changed files: \`${current.changedFiles}\``);
  console.log(`- Gates recorded: \`${gates.length}\`; failed: \`${failedGates.length}\`\n`);

  if (events.length === 0) {
    console.log("No events recorded for this run.\n");
    return;
  }
  console.log("| Time | Event | Subject | Exit | HEAD | Dirty | Summary |");
  console.log("| --- | --- | --- | ---: | --- | --- | --- |");
  for (const event of events) {
    console.log(
      `| ${markdownCell(event.timestamp)} | ${markdownCell(event.event)} | ${markdownCell(event.subject)} | ${markdownCell(event.exitCode ?? "-")} | ${markdownCell(event.headSha.slice(0, 8))} | ${markdownCell(event.dirtyHash.slice(0, 8))} | ${markdownCell(event.summary)} |`,
    );
  }
  console.log();
}

function usage() {
  console.log(`Usage:
  node scripts/agent-workflow/evidence.mjs start [summary]
  node scripts/agent-workflow/evidence.mjs record <event> <subject> <exit-code|-> [summary]
  node scripts/agent-workflow/evidence.mjs finish <passed|failed|incomplete> [summary]
  node scripts/agent-workflow/evidence.mjs current [--json]
  node scripts/agent-workflow/evidence.mjs report [--json]`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "start":
    console.log(startRun(args.join(" ")));
    break;
  case "record": {
    if (args.length < 3) {
      usage();
      process.exitCode = 1;
      break;
    }
    const runId = requireRun();
    const rawExitCode = args[2];
    const exitCode = rawExitCode === "-" ? null : Number(rawExitCode);
    if (exitCode !== null && !Number.isInteger(exitCode)) {
      throw new Error(`Invalid exit code: ${rawExitCode}`);
    }
    recordEvent(runId, args[0], args[1], exitCode, args.slice(3).join(" "));
    console.log(runId);
    break;
  }
  case "finish":
    if (!new Set(["passed", "failed", "incomplete"]).has(args[0])) {
      usage();
      process.exitCode = 1;
      break;
    }
    console.log(finishRun(args[0], args.slice(1).join(" ")));
    break;
  case "current": {
    const runId = requireRun();
    if (args.includes("--json")) {
      console.log(JSON.stringify(readJson(runPaths(runId).metadata), null, 2));
    } else {
      console.log(runId);
    }
    break;
  }
  case "report":
    printReport(requireRun(), args.includes("--json"));
    break;
  case "--help":
  case "-h":
    usage();
    break;
  default:
    usage();
    process.exitCode = 1;
}
