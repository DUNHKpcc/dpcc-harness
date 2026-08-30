#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = process.env.ELECTRON_PATH || require("electron");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const fixturePath = path.join(repoRoot, "scripts", "fixtures", "pi-rpc-fixture.mjs");

const EXIT_CODES = {
  unavailable: 70,
  timeout: 71,
  firstExit: 72,
  recoveryFailed: 73,
  orphanChild: 74,
  badResult: 75,
  launcherError: 76,
};
const REQUIRED_ARTIFACTS = [
  path.join(repoRoot, "electron", "dist", "main.js"),
  path.join(repoRoot, "electron", "dist", "preload.js"),
  path.join(repoRoot, "dist", "index.html"),
];
const MAIN_BUNDLE_MARKERS = [
  "HARNSS_E2E_MODE",
  "registerAcpRecoveryIpc",
  "buildAcpRecoveryRendererUrl",
];
const PRELOAD_BUNDLE_MARKERS = [
  "isAcpRecoveryTest",
  "__harnssE2e",
  "harnss:e2e:normalize-session",
  "harnss:e2e:terminate-runtime",
];
const DEFAULT_TIMEOUT_MS = process.env.CI === "true" ? 120_000 : 60_000;

function parseArgs(argv) {
  const parsed = { json: false, testMode: null, scenario: "all" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") parsed.json = true;
    else if (value === "--test-mode") { parsed.testMode = argv[index + 1] ?? ""; index += 1; }
    else if (value.startsWith("--test-mode=")) parsed.testMode = value.slice("--test-mode=".length);
    else if (value === "--scenario") { parsed.scenario = argv[index + 1] ?? "all"; index += 1; }
    else if (value.startsWith("--scenario=")) parsed.scenario = value.slice("--scenario=".length);
  }
  parsed.testMode ||= String(process.env.HARNSS_E2E_MODE ?? "").trim();
  return parsed;
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

function readLogTail(filePath, replacements, maxChars = 12_000) {
  let value = readText(filePath);
  for (const [source, replacement] of replacements) {
    if (source) value = value.split(source).join(replacement);
  }
  return value.slice(-maxChars);
}

function latestMainLogPath() {
  const logsDir = path.join(repoRoot, "logs");
  try {
    return fs.readdirSync(logsDir)
      .filter((name) => /^main-\d+\.log$/.test(name))
      .map((name) => {
        const filePath = path.join(logsDir, name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

function collectFailureDiagnostics(workspace, electronLogPath) {
  const replacements = [
    [workspace.paths.root, "<workspace>"],
    [repoRoot, "<repo>"],
    [workspace.paths.home, "<home>"],
  ];
  const mainLogPath = latestMainLogPath();
  return {
    electronLogTail: readLogTail(electronLogPath, replacements),
    mainLogTail: mainLogPath ? readLogTail(mainLogPath, replacements) : "",
  };
}

function buildArtifactStatus() {
  return REQUIRED_ARTIFACTS.map((filePath) => ({ path: filePath, exists: fs.existsSync(filePath) }));
}

function detectHarnessContract() {
  const mainBundleText = readText(path.join(repoRoot, "electron", "dist", "main.js"));
  const preloadBundleText = readText(path.join(repoRoot, "electron", "dist", "preload.js"));
  const sourceText = [
    readText(path.join(repoRoot, "electron", "src", "main.ts")),
    readText(path.join(repoRoot, "electron", "src", "preload.ts")),
    readText(path.join(repoRoot, "electron", "src", "lib", "e2e", "acp-recovery-harness.ts")),
  ].join("\n");
  const mainMarkers = MAIN_BUNDLE_MARKERS.filter((marker) => mainBundleText.includes(marker));
  const preloadMarkers = PRELOAD_BUNDLE_MARKERS.filter((marker) => preloadBundleText.includes(marker));
  return {
    sourceHarnessExists: Boolean(readText(path.join(repoRoot, "electron", "src", "lib", "e2e", "acp-recovery-harness.ts"))),
    sourceMarkers: ["registerAcpRecoveryIpc", "buildAcpRecoveryRendererUrl"].filter((marker) => sourceText.includes(marker)),
    mainBundleSupportsRecovery: mainMarkers.length === MAIN_BUNDLE_MARKERS.length,
    preloadBundleSupportsRecovery: preloadMarkers.length === PRELOAD_BUNDLE_MARKERS.length,
    mainMarkers,
    preloadMarkers,
  };
}

function unavailableResult(reason, detail) {
  return {
    ok: false,
    code: "electron_recovery_harness_unavailable",
    stage: "preflight",
    mode: "acp-recovery",
    reason,
    detail,
    requiredContract: [
      "Build electron/dist/main.js, electron/dist/preload.js and dist/index.html first.",
      "Recovery must use explicit HARNSS_E2E_MODE/--test-mode=acp-recovery only.",
      "The test renderer must call production preload ACP APIs and write result.json through test-only IPC.",
    ],
  };
}

function createWorkspace(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harnss-electron-recovery-${scenario}-`));
  const paths = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    project: path.join(root, "project"),
    piDir: path.join(root, "pi-coding-agent"),
    piSessionDir: path.join(root, "pi-sessions"),
    result: path.join(root, "result.json"),
    logs: path.join(root, "logs"),
  };
  for (const directory of [paths.userData, paths.home, paths.project, paths.piDir, paths.piSessionDir, paths.logs]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(paths.project, "README.md"), "# recovery fixture\n", "utf8");
  const env = {
    ...process.env,
    CI: process.env.CI || "true",
    LC_ALL: "C",
    LANG: "C",
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: path.join(paths.home, ".config"),
    XDG_CACHE_HOME: path.join(paths.home, ".cache"),
    XDG_DATA_HOME: path.join(paths.home, ".local", "share"),
    APPDATA: path.join(paths.home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(paths.home, "AppData", "Local"),
    HARNSS_E2E_MODE: "acp-recovery",
    HARNSS_E2E_SCENARIO: scenario,
    HARNSS_E2E_RESULT_PATH: paths.result,
    HARNSS_E2E_USER_DATA: paths.userData,
    HARNSS_E2E_HOME: paths.home,
    HARNSS_E2E_PROJECT_DIR: paths.project,
    HARNSS_E2E_PROJECT_ID: "e2e-project",
    HARNSS_E2E_WORKSPACE_DIR: repoRoot,
    PI_CODING_AGENT_DIR: paths.piDir,
    PI_CODING_AGENT_SESSION_DIR: paths.piSessionDir,
    PI_ACP_PI_COMMAND: fixturePath,
    PI_RPC_FIXTURE_MODE: "",
    ...(scenario === "timeout" ? { PCC_AGENT_ACP_PROMPT_INACTIVITY_TIMEOUT_MS: "500" } : {}),
    ELECTRON_ENABLE_LOGGING: "1",
  };
  return { paths, env };
}

function removeDir(directory) {
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
}

function spawnElectron({ env, args, logPath }) {
  // Electron's CLI requires an application path; without it the binary only
  // prints its usage text and the recovery test never reaches the renderer.
  // The temporary HOME must not make this test touch the developer's macOS Keychain.
  const keychainArgs = process.platform === "darwin" ? ["--use-mock-keychain"] : [];
  const child = spawn(electronBinary, [repoRoot, ...keychainArgs, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const output = fs.createWriteStream(logPath, { flags: "a" });
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);
  child.once("close", () => output.end());
  return child;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    if (!child) { resolve({ code: null, signal: null }); return; }
    const onError = (error) => { child.removeListener("exit", onExit); reject(error); };
    const onExit = (code, signal) => { child.removeListener("error", onError); resolve({ code, signal }); };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function terminateProcess(child, signal = "SIGTERM", group = true) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (group && process.platform !== "win32" && typeof child.pid === "number") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function waitForPidsGone(pids, timeoutMs = 5000) {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = unique.filter(pidIsAlive);
    if (alive.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return unique.filter(pidIsAlive);
}

function listDescendantPids(rootPids) {
  if (process.platform === "win32") return [];
  const result = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];

  const childrenByParent = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const children = childrenByParent.get(ppid) || [];
    children.push(pid);
    childrenByParent.set(ppid, children);
  }

  const descendants = [];
  const pending = [...rootPids];
  const seen = new Set(rootPids);
  while (pending.length > 0) {
    const parent = pending.shift();
    for (const child of childrenByParent.get(parent) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      pending.push(child);
    }
  }
  return descendants;
}

function readResult(resultPath) {
  if (!fs.existsSync(resultPath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("result.json must contain an object");
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Missing recovery result");
  const code = typeof raw.code === "string" && raw.code.trim() ? raw.code.trim() : raw.ok === true ? "ok" : null;
  if (!code) throw new Error("result.json is missing a terminal code");
  return {
    ok: raw.ok === true,
    code,
    stage: typeof raw.stage === "string" ? raw.stage : "unknown",
    message: typeof raw.message === "string" ? raw.message : "",
    details: raw.details && typeof raw.details === "object" ? raw.details : null,
    first: raw.first && typeof raw.first === "object" ? raw.first : null,
    second: raw.second && typeof raw.second === "object" ? raw.second : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    agentSessionId: typeof raw.agentSessionId === "string" ? raw.agentSessionId : null,
  };
}

function waitForResult(resultPath, child, acceptedCodes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      try {
        const raw = readResult(resultPath);
        if (raw) {
          const normalized = normalizeResult(raw);
          if (acceptedCodes.includes(normalized.code) || !normalized.code.startsWith("ready_")) { resolve(normalized); return; }
        }
      } catch (error) { reject(error); return; }
      if (child && child.exitCode !== null && !fs.existsSync(resultPath)) {
        reject(new Error(`Electron exited before result.json (code=${child.exitCode}, signal=${child.signalCode})`));
        return;
      }
      if (Date.now() >= deadline) { reject(new Error(`Timed out waiting for ${acceptedCodes.join("/")} result`)); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function exitCodeFor(code) {
  if (code === "ok") return 0;
  if (code === "electron_recovery_timeout") return EXIT_CODES.timeout;
  if (code === "electron_recovery_first_exit") return EXIT_CODES.firstExit;
  if (code === "electron_recovery_orphan_child") return EXIT_CODES.orphanChild;
  if (code === "electron_recovery_bad_result") return EXIT_CODES.badResult;
  if (code === "electron_recovery_launcher_error") return EXIT_CODES.launcherError;
  return EXIT_CODES.recoveryFailed;
}

function printResult(result, json) {
  if (json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  const stream = result.ok ? console.log : console.error;
  stream(`electron ACP recovery: ${result.ok ? "OK" : "FAIL"} (${result.code})`);
  if (result.message) stream(result.message);
  if (result.scenarios) stream(JSON.stringify(result.scenarios, null, 2));
}

async function runPair(scenario) {
  const workspace = createWorkspace(scenario);
  const firstLogPath = path.join(workspace.paths.logs, "first.log");
  const resumeLogPath = path.join(workspace.paths.logs, "resume.log");
  let first = null;
  let second = null;
  let firstExit = null;
  let secondExit = null;
  let firstResult = null;
  let succeeded = false;
  try {
    const commonArgs = [
      "--test-mode=acp-recovery",
      `--test-result-path=${workspace.paths.result}`,
      `--test-scenario=${scenario}`,
    ];
    first = spawnElectron({ env: { ...workspace.env, HARNSS_E2E_PHASE: "first" }, args: commonArgs, logPath: firstLogPath });
    const firstExitPromise = waitForExit(first);
    firstResult = await waitForResult(workspace.paths.result, first, ["ready_for_restart", "ready_for_crash"], DEFAULT_TIMEOUT_MS);
    const runtime = firstResult.first?.runtime;
    const oldChildPids = runtime?.pid
      ? [runtime.pid, ...listDescendantPids([runtime.pid])]
      : [];
    if (!firstResult.sessionId || !firstResult.agentSessionId || oldChildPids.length === 0) {
      throw Object.assign(new Error("First phase did not return session identity and live ACP child PID."), { code: "electron_recovery_bad_result" });
    }

    if (scenario === "crash") terminateProcess(first, "SIGKILL", false);
    else terminateProcess(first, "SIGTERM", true);
    firstExit = await firstExitPromise;
    if (scenario === "success" && firstExit.code !== 0 && firstExit.signal == null) {
      throw Object.assign(new Error(`First Electron process exited abnormally (code=${firstExit.code})`), { code: "electron_recovery_first_exit" });
    }
    const orphanBeforeResume = await waitForPidsGone(oldChildPids, scenario === "crash" ? 8000 : 3000);
    if (orphanBeforeResume.length > 0 && scenario === "crash") {
      throw Object.assign(new Error(`ACP child survived abnormal Electron exit: ${orphanBeforeResume.join(", ")}`), { code: "electron_recovery_orphan_child" });
    }

    fs.rmSync(workspace.paths.result, { force: true });
    const resumeEnv = {
      ...workspace.env,
      HARNSS_E2E_PHASE: "resume",
      HARNSS_E2E_SESSION_ID: firstResult.sessionId,
      HARNSS_E2E_AGENT_SESSION_ID: firstResult.agentSessionId,
    };
    second = spawnElectron({ env: resumeEnv, args: [...commonArgs, "--test-phase=resume"], logPath: resumeLogPath });
    const secondExitPromise = waitForExit(second);
    const secondResult = await waitForResult(workspace.paths.result, second, ["ok"], DEFAULT_TIMEOUT_MS);
    secondExit = await Promise.race([secondExitPromise, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
    if (!secondExit) {
      terminateProcess(second, "SIGTERM", true);
      throw Object.assign(new Error("Second Electron process did not exit after writing result."), { code: "electron_recovery_restore_failed" });
    }
    if (secondExit.code !== 0 && secondExit.signal == null) {
      throw Object.assign(new Error(`Second Electron process exited abnormally (code=${secondExit.code})`), { code: "electron_recovery_restore_failed" });
    }
    const reportedPids = [
      ...(firstResult.first?.runtime?.pid ? [firstResult.first.runtime.pid] : []),
      ...((secondResult.second?.remainingRuntime ?? []).map((item) => item.pid)),
    ];
    const remaining = await waitForPidsGone(reportedPids, 3000);
    if (remaining.length > 0) throw Object.assign(new Error(`ACP child process remained after recovery: ${remaining.join(", ")}`), { code: "electron_recovery_orphan_child" });
    succeeded = true;
    return {
      scenario,
      ok: true,
      code: "ok",
      first: { code: firstResult.code, sessionId: firstResult.sessionId, agentSessionId: firstResult.agentSessionId, exit: firstExit },
      second: { code: secondResult.code, stage: secondResult.stage, exit: secondExit },
    };
  } catch (error) {
    if (first && first.exitCode === null && first.signalCode === null) terminateProcess(first, "SIGKILL", true);
    if (second && second.exitCode === null && second.signalCode === null) terminateProcess(second, "SIGKILL", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      scenario,
      ok: false,
      code: error?.code || "electron_recovery_restore_failed",
      message: error instanceof Error ? error.message : String(error),
      firstExit,
      secondExit,
      workspaceRoot: workspace.paths.root,
      logs: { first: firstLogPath, second: resumeLogPath },
      diagnostics: collectFailureDiagnostics(workspace, second ? resumeLogPath : firstLogPath),
    };
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (succeeded) removeDir(workspace.paths.root);
  }
}

async function runOnePhaseFailureScenario(scenario) {
  const workspace = createWorkspace(scenario);
  const logPath = path.join(workspace.paths.logs, `${scenario}.log`);
  let child = null;
  let childExit = null;
  let succeeded = false;
  try {
    const args = [
      "--test-mode=acp-recovery",
      `--test-result-path=${workspace.paths.result}`,
      `--test-scenario=${scenario}`,
    ];
    child = spawnElectron({
      env: { ...workspace.env, HARNSS_E2E_PHASE: "first" },
      args,
      logPath,
    });
    const exitPromise = waitForExit(child);
    const result = await waitForResult(workspace.paths.result, child, ["ok"], DEFAULT_TIMEOUT_MS);
    childExit = await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (!childExit) {
      terminateProcess(child, "SIGTERM", true);
      throw Object.assign(new Error(`${scenario} E2E did not exit after writing result.`), { code: "electron_recovery_timeout" });
    }
    if (childExit.code !== 0 && childExit.signal == null) {
      throw Object.assign(new Error(`${scenario} E2E exited abnormally (code=${childExit.code})`), { code: "electron_recovery_first_exit" });
    }
    const runtimePid = result.first?.runtime?.pid;
    const remaining = runtimePid ? await waitForPidsGone([runtimePid], 5_000) : [];
    if (remaining.length > 0) {
      throw Object.assign(new Error(`${scenario} ACP child remained alive: ${remaining.join(", ")}`), { code: "electron_recovery_orphan_child" });
    }
    succeeded = true;
    return {
      scenario,
      ok: true,
      code: "ok",
      first: { code: result.code, stage: result.stage, exit: childExit },
    };
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) terminateProcess(child, "SIGKILL", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      scenario,
      ok: false,
      code: error?.code || "electron_recovery_timeout",
      message: error instanceof Error ? error.message : String(error),
      firstExit: childExit,
      workspaceRoot: workspace.paths.root,
      logs: { first: logPath },
      diagnostics: collectFailureDiagnostics(workspace, logPath),
    };
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (succeeded) removeDir(workspace.paths.root);
  }
}

async function main() {
  const { json, testMode, scenario } = parseArgs(process.argv.slice(2));
  const artifacts = buildArtifactStatus();
  const contract = detectHarnessContract();
  if (testMode !== "acp-recovery") {
    const result = unavailableResult(`Explicit test mode is required, received "${testMode || "<missing>"}".`, { artifacts, contract });
    printResult(result, json);
    process.exitCode = EXIT_CODES.unavailable;
    return;
  }
  if (artifacts.some((item) => !item.exists) || !contract.sourceHarnessExists || !contract.mainBundleSupportsRecovery || !contract.preloadBundleSupportsRecovery) {
    const result = unavailableResult("Recovery E2E requires a freshly built Electron bundle and test harness.", { artifacts, contract });
    printResult(result, json);
    process.exitCode = EXIT_CODES.unavailable;
    return;
  }
  const scenarios = ["success", "crash", "timeout", "child-exit", "stop-active"].includes(scenario)
    ? [scenario]
    : ["success", "crash", "timeout", "child-exit", "stop-active"];
  const results = [];
  for (const currentScenario of scenarios) {
    const scenarioResult = currentScenario === "timeout"
      || currentScenario === "child-exit"
      || currentScenario === "stop-active"
      ? await runOnePhaseFailureScenario(currentScenario)
      : await runPair(currentScenario);
    results.push(scenarioResult);
    if (!scenarioResult.ok) break;
  }
  const result = {
    ok: results.length === scenarios.length && results.every((item) => item.ok),
    code: results.every((item) => item.ok) ? "ok" : results.find((item) => !item.ok)?.code || "electron_recovery_restore_failed",
    mode: "acp-recovery",
    scenarios: results,
  };
  printResult(result, json);
  process.exitCode = exitCodeFor(result.code);
}

await main();
