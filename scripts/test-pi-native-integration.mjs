#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { startPiNativeProviderFixture } from "./fixtures/pi-native-provider-fixture.mjs";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_MANIFEST_PATH = path.join(SCRIPT_DIR, "pi-runtime-versions.json");
const MCP_FIXTURE_PATH = path.join(SCRIPT_DIR, "fixtures", "pi-native-mcp-fixture.mjs");
const TEST_TIMEOUT_MS = Number(process.env.PI_NATIVE_TEST_TIMEOUT_MS ?? (process.env.CI === "true" ? 90000 : 45000));
const FIXTURE_API_KEY = "pi-native-fixture-key";
const MODEL_ID = "native-fixture-model";
const PROVIDER_ID = "pi-native-fixture";

const EXIT_CODES = {
  ok: 0,
  pi_bundled_package_missing: 41,
  pi_version_unsupported: 42,
  fixture_error: 43,
  cli_spawn_error: 44,
  cli_timeout: 45,
  cli_exit_unexpected: 46,
  native_protocol_error: 47,
  assertion_failed: 48,
  session_persistence_error: 49,
};

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveHeadlessElectronHost(executablePath) {
  if (process.platform !== "darwin") return executablePath;
  const macOsDirectory = path.dirname(executablePath);
  const contentsDirectory = path.dirname(macOsDirectory);
  const appDirectory = path.dirname(contentsDirectory);
  if (path.basename(macOsDirectory) !== "MacOS"
    || path.basename(contentsDirectory) !== "Contents"
    || path.extname(appDirectory) !== ".app") {
    return executablePath;
  }
  const executableName = path.basename(executablePath);
  const helperName = `${executableName} Helper`;
  return path.join(contentsDirectory, "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
}

function resolveBundledPi() {
  const manifest = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST_PATH, "utf8"));
  const entry = manifest?.binaries?.pi;
  const mcpAdapter = manifest?.extensions?.["pi-mcp-adapter"];
  if (!entry
    || entry.package !== "@earendil-works/pi-coding-agent"
    || typeof entry.version !== "string"
    || typeof entry.entry !== "string"
    || mcpAdapter?.package !== "pi-mcp-adapter"
    || typeof mcpAdapter.version !== "string"
    || typeof mcpAdapter.entry !== "string") {
    throw codedError("pi_version_unsupported", "Pi runtime manifest is invalid");
  }
  const hostPath = resolveHeadlessElectronHost(String(require("electron")));
  const entryPath = path.join(REPO_ROOT, "node_modules", ...entry.package.split("/"), entry.entry);
  const mcpAdapterEntryPath = path.join(
    REPO_ROOT,
    "node_modules",
    ...mcpAdapter.package.split("/"),
    mcpAdapter.entry,
  );
  const wrapperPath = path.join(
    REPO_ROOT,
    "build",
    "pi-runtime",
    "bin",
    process.platform === "win32" ? "pi.cmd" : "pi",
  );
  const mcpBridgePath = path.join(REPO_ROOT, "build", "pi-runtime", "extensions", "pcc-mcp.ts");
  try {
    fs.accessSync(hostPath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    fs.accessSync(entryPath, fs.constants.F_OK);
    fs.accessSync(mcpAdapterEntryPath, fs.constants.F_OK);
    fs.accessSync(wrapperPath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    fs.accessSync(mcpBridgePath, fs.constants.F_OK);
    fs.accessSync(MCP_FIXTURE_PATH, fs.constants.F_OK);
  } catch {
    throw codedError("pi_bundled_package_missing", "bundled Pi runtime is unavailable");
  }
  return {
    hostPath,
    entryPath,
    expectedVersion: entry.version,
    mcpAdapterEntryPath,
    mcpAdapterVersion: mcpAdapter.version,
    wrapperPath,
    mcpBridgePath,
  };
}

function findPackageVersion(executable) {
  try {
    let directory = path.dirname(fs.realpathSync(executable));
    for (let depth = 0; depth < 8; depth += 1) {
      const packagePath = path.join(directory, "package.json");
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (packageJson.name === "@earendil-works/pi-coding-agent") return packageJson.version;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    return null;
  }
  return null;
}

async function makePaths() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "harnss-pi-native-"));
  const paths = {
    root,
    home: path.join(root, "home"),
    agentDir: path.join(root, "pi-agent"),
    sessionDir: path.join(root, "sessions"),
    workspace: path.join(root, "workspace"),
  };
  await Promise.all(Object.values(paths).slice(1).map((directory) => fsp.mkdir(directory, { recursive: true })));
  await fsp.writeFile(path.join(paths.workspace, "README.md"), "native integration fixture\n", "utf8");
  return paths;
}

function isolatedEnvironment(paths, baseUrl) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|ACCESS_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: path.join(paths.root, "xdg-config"),
    XDG_DATA_HOME: path.join(paths.root, "xdg-data"),
    XDG_CACHE_HOME: path.join(paths.root, "xdg-cache"),
    PI_CODING_AGENT_DIR: paths.agentDir,
    PI_CODING_AGENT_SESSION_DIR: paths.sessionDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    NO_COLOR: "1",
    LANG: "C",
    LC_ALL: "C",
  });
  return env;
}

async function writeModelsConfig(paths, baseUrl) {
  await fsp.writeFile(path.join(paths.agentDir, "models.json"), JSON.stringify({
    providers: {
      [PROVIDER_ID]: {
        baseUrl,
        api: "openai-completions",
        apiKey: FIXTURE_API_KEY,
        models: [{
          id: MODEL_ID,
          name: "Native fixture model",
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 256,
        }],
      },
    },
  }, null, 2), "utf8");
}

function killProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && typeof child.pid === "number") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
  }
}

async function runPi({ runtime, paths, baseUrl, sessionId, prompt, mcpConfigPath, skillPath }) {
  const args = [
    "--mode", "json",
    "--print",
    "--provider", PROVIDER_ID,
    "--model", MODEL_ID,
    "--api-key", FIXTURE_API_KEY,
    "--session-dir", paths.sessionDir,
    "--session-id", sessionId,
    "--thinking", "off",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--offline",
    prompt,
  ];
  if (skillPath) args.splice(args.indexOf("--no-skills"), 1);
  if (!mcpConfigPath) {
    args.splice(args.indexOf("--no-skills"), 0, "--no-extensions");
  }
  if (!mcpConfigPath && !skillPath) {
    args.splice(args.indexOf("--offline"), 0, "--no-tools");
  }
  const useWrapper = Boolean(mcpConfigPath || skillPath);
  const env = {
    ...isolatedEnvironment(paths, baseUrl),
    ELECTRON_RUN_AS_NODE: "1",
    ...(useWrapper ? {
      PCC_AGENT_PI_RUNTIME_HOST: runtime.hostPath,
      PCC_AGENT_PI_ENTRY: runtime.entryPath,
    } : {}),
    ...(skillPath ? {
      PCC_AGENT_PI_GLOBAL_SKILLS: skillPath,
    } : {}),
    ...(mcpConfigPath ? {
      PCC_AGENT_PI_MCP_EXTENSION: runtime.mcpBridgePath,
      PCC_AGENT_PI_MCP_CONFIG: mcpConfigPath,
      PCC_AGENT_PI_MCP_ADAPTER: runtime.mcpAdapterEntryPath,
    } : {}),
  };
  const command = useWrapper ? runtime.wrapperPath : runtime.hostPath;
  const commandArgs = useWrapper ? args : [runtime.entryPath, ...args];
  const child = spawn(command, commandArgs, {
    cwd: paths.workspace,
    env,
    shell: Boolean(mcpConfigPath && process.platform === "win32"),
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  let stdoutSize = 0;
  let stderrSize = 0;
  let spawnError = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutSize += chunk.length;
    if (stdoutSize <= 1024 * 1024) stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrSize += chunk.length;
    if (stderrSize <= 256 * 1024) stderr.push(chunk);
  });
  child.on("error", (error) => { spawnError = error; });

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      killProcess(child);
      resolve({ timedOut: true, code: null, signal: "SIGTERM" });
    }, TEST_TIMEOUT_MS);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, signal });
    });
  });
  if (spawnError) throw codedError("cli_spawn_error", "pi could not be started");
  if (result.timedOut) throw codedError("cli_timeout", "pi timed out");

  const events = [];
  for (const line of stdout.join("").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw codedError("native_protocol_error", "pi JSON mode returned a non-JSON line");
    }
  }
  return {
    ...result,
    events,
    stderrBytes: Buffer.byteLength(stderr.join("")),
    stderrTail: stderr.join("").slice(-2_000),
  };
}

function assertCondition(condition, message, code = "assertion_failed") {
  if (!condition) throw codedError(code, message);
}

function terminalMessages(events) {
  return events.filter((event) => event?.type === "message_end" || event?.type === "turn_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
}

function completedTerminal(events) {
  return terminalMessages(events).find((message) => message.stopReason === "stop");
}

function failureTerminal(events) {
  return terminalMessages(events).find((message) => message.stopReason === "error" || message.stopReason === "aborted");
}

async function sessionFiles(sessionDir) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.name.endsWith(".jsonl")) files.push(entryPath);
    }
  }
  await visit(sessionDir);
  return files;
}

async function readSession(sessionDir, expectedSessionId) {
  const files = await sessionFiles(sessionDir);
  assertCondition(files.length > 0, "no native Pi session file was persisted", "session_persistence_error");
  const filePath = files.find((candidate) => fs.readFileSync(candidate, "utf8").includes(`"id":"${expectedSessionId}"`)) ?? files[0];
  const content = await fsp.readFile(filePath, "utf8");
  const entries = content.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { throw codedError("session_persistence_error", "native session JSONL is invalid"); }
  });
  const header = entries.find((entry) => entry.type === "session");
  assertCondition(header?.id === expectedSessionId, "native session identity was not persisted", "session_persistence_error");
  return { content, entries, filePath };
}

async function runSuccessAndContinuation(runtime, paths) {
  const fixture = await startPiNativeProviderFixture({ mode: "success", apiKey: FIXTURE_API_KEY });
  try {
    await writeModelsConfig(paths, fixture.baseUrl);
    const sessionId = "native-tier-b-session";
    const first = await runPi({ runtime, paths, baseUrl: fixture.baseUrl, sessionId, prompt: "first native fixture prompt" });
    assertCondition(first.code === 0, "normal native prompt exited unsuccessfully");
    assertCondition(completedTerminal(first.events)?.stopReason === "stop", "normal native prompt did not settle with stop");
    const persistedAfterFirst = await readSession(paths.sessionDir, sessionId);

    const second = await runPi({ runtime, paths, baseUrl: fixture.baseUrl, sessionId, prompt: "second native fixture prompt" });
    assertCondition(second.code === 0, "continued native prompt exited unsuccessfully");
    assertCondition(completedTerminal(second.events)?.stopReason === "stop", "continued native prompt did not settle with stop");
    const persistedAfterSecond = await readSession(paths.sessionDir, sessionId);
    const userMessages = persistedAfterSecond.entries.filter((entry) => entry.type === "message" && entry.message?.role === "user");
    const assistantMessages = persistedAfterSecond.entries.filter((entry) => entry.type === "message" && entry.message?.role === "assistant");
    assertCondition(userMessages.length >= 2 && assistantMessages.length >= 2, "native session was not continued by the later process");
    assertCondition(persistedAfterSecond.content === persistedAfterSecond.content.replace(/Retrying(?: \(attempt \d+\/\d+, waiting \d+s\))?\.\.\./g, ""), "retry diagnostics leaked into persisted assistant history");
    return { requests: fixture.requestCount, sessionFileStable: persistedAfterFirst.filePath === persistedAfterSecond.filePath };
  } finally {
    await fixture.close();
  }
}

async function runRecoverAfterRetry(runtime, paths) {
  const fixture = await startPiNativeProviderFixture({ mode: "recover", apiKey: FIXTURE_API_KEY });
  try {
    await writeModelsConfig(paths, fixture.baseUrl);
    const sessionId = `native-retry-${crypto.randomUUID().slice(0, 8)}`;
    const result = await runPi({ runtime, paths, baseUrl: fixture.baseUrl, sessionId, prompt: "recover after local provider interruption" });
    assertCondition(result.code === 0, "native provider retry did not recover");
    assertCondition(fixture.requestCount >= 2, "native Pi did not retry after the provider interruption");
    assertCondition(completedTerminal(result.events)?.stopReason === "stop", "recovered native prompt did not settle with stop");
    const persisted = await readSession(paths.sessionDir, sessionId);
    assertCondition(!/Retrying(?: \(attempt \d+\/\d+, waiting \d+s\))?\.\.\./.test(persisted.content), "native retry notice was persisted as assistant history");
    return { requests: fixture.requestCount };
  } finally {
    await fixture.close();
  }
}

async function runMcpExposure(runtime, paths) {
  const fixture = await startPiNativeProviderFixture({ mode: "success", apiKey: FIXTURE_API_KEY });
  try {
    await writeModelsConfig(paths, fixture.baseUrl);
    const markerPath = path.join(paths.root, "mcp-fixture-started");
    const configPath = path.join(paths.root, "pi-mcp.json");
    await fsp.writeFile(configPath, JSON.stringify({
      settings: {
        directTools: true,
        scriptMode: false,
        sampling: false,
        elicitation: false,
        notifyOnStartupConnect: false,
      },
      mcpServers: {
        fixture: {
          command: runtime.hostPath,
          args: [MCP_FIXTURE_PATH],
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            PI_MCP_FIXTURE_MARKER: markerPath,
          },
          lifecycle: "eager",
        },
      },
    }, null, 2), { encoding: "utf8", mode: 0o600 });

    const result = await runPi({
      runtime,
      paths,
      baseUrl: fixture.baseUrl,
      sessionId: `native-mcp-${crypto.randomUUID().slice(0, 8)}`,
      prompt: "confirm the configured MCP tool is available",
      mcpConfigPath: configPath,
    });
    assertCondition(result.code === 0, "Pi MCP-enabled prompt exited unsuccessfully");
    assertCondition(fs.existsSync(markerPath), "the configured MCP child process was not started");
    const toolNames = [...new Set(fixture.requests.flatMap((request) => request.toolNames))];
    assertCondition(toolNames.includes("mcp"), "Pi did not expose the MCP adapter proxy tool");
    assertCondition(
      toolNames.some((name) => name.includes("fixture_echo")),
      "Pi did not expose the configured MCP server tool",
    );
    return { requests: fixture.requestCount, toolNames };
  } finally {
    await fixture.close();
  }
}

async function runProjectSkillExposure(runtime, paths) {
  const fixture = await startPiNativeProviderFixture({ mode: "success", apiKey: FIXTURE_API_KEY });
  try {
    await writeModelsConfig(paths, fixture.baseUrl);
    const skillName = "pcc-agent-native-fixture";
    const skillMarker = "PCC_AGENT_NATIVE_SKILL_VISIBLE";
    const skillsPath = path.join(paths.workspace, ".agents", "skills");
    const skillDirectory = path.join(skillsPath, skillName);
    await fsp.mkdir(skillDirectory, { recursive: true });
    await fsp.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      `name: ${skillName}`,
      `description: ${skillMarker}`,
      "---",
      "Use this fixture only for native integration verification.",
      "",
    ].join("\n"), "utf8");

    const result = await runPi({
      runtime,
      paths,
      baseUrl: fixture.baseUrl,
      sessionId: `native-skill-${crypto.randomUUID().slice(0, 8)}`,
      prompt: "confirm the configured Skill is visible",
      skillPath: skillsPath,
    });
    assertCondition(result.code === 0, "Pi Skill-enabled prompt exited unsuccessfully");
    assertCondition(
      fixture.requests.some((request) => request.messageText.includes(skillMarker)),
      `Pi did not include the explicitly managed project Skill in model context; observed=${JSON.stringify(
        {
          requests: fixture.requests.map((request) => ({
            messageBytes: Buffer.byteLength(request.messageText),
            hasSkillsBlock: request.messageText.includes("<available_skills>"),
            hasSkillName: request.messageText.includes(skillName),
          })),
          eventTypes: result.events.map((event) => event?.type).filter(Boolean),
          stderrTail: result.stderrTail,
        },
      )}`,
    );
    return { requests: fixture.requestCount, skillName };
  } finally {
    await fixture.close();
  }
}

async function runFailureDoesNotSucceed(runtime, paths, mode) {
  const fixture = await startPiNativeProviderFixture({ mode, apiKey: FIXTURE_API_KEY });
  try {
    await writeModelsConfig(paths, fixture.baseUrl);
    const sessionId = `native-failure-${mode}-${crypto.randomUUID().slice(0, 8)}`;
    const result = await runPi({ runtime, paths, baseUrl: fixture.baseUrl, sessionId, prompt: `provider ${mode} fixture failure` });
    assertCondition(
      result.code !== 0 || Boolean(failureTerminal(result.events)) || !completedTerminal(result.events),
      `native ${mode} failure was incorrectly reported as success`,
    );
    assertCondition(fixture.requestCount > 0, `native ${mode} fixture was not reached`);
    return { requests: fixture.requestCount, exitCode: result.code };
  } finally {
    await fixture.close();
  }
}

async function main() {
  const runtime = resolveBundledPi();
  const version = findPackageVersion(runtime.entryPath);
  if (version !== runtime.expectedVersion) throw codedError("pi_version_unsupported", "unsupported bundled Pi runtime");
  const mcpAdapterVersion = JSON.parse(fs.readFileSync(
    path.join(path.dirname(runtime.mcpAdapterEntryPath), "package.json"),
    "utf8",
  )).version;
  if (mcpAdapterVersion !== runtime.mcpAdapterVersion) {
    throw codedError("pi_version_unsupported", "unsupported bundled Pi MCP adapter");
  }

  const paths = await makePaths();
  try {
    const success = await runSuccessAndContinuation(runtime, paths);
    const recovered = await runRecoverAfterRetry(runtime, paths);
    const skill = await runProjectSkillExposure(runtime, paths);
    const mcp = await runMcpExposure(runtime, paths);
    const disconnected = await runFailureDoesNotSucceed(runtime, paths, "disconnect");
    const httpFailure = await runFailureDoesNotSucceed(runtime, paths, "http-failure");
    console.log(`PI_NATIVE_INTEGRATION_OK ${JSON.stringify({
      tier: "B",
      piSource: "bundled",
      piVersion: version,
      mcpAdapterVersion,
      scenarios: {
        successAndContinuation: success,
        recoverAfterRetry: recovered,
        projectSkillExposure: skill,
        mcpExposure: mcp,
        disconnectFailure: disconnected,
        httpFailure,
      },
    })}`);
  } finally {
    await fsp.rm(paths.root, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const code = error?.code && EXIT_CODES[error.code] ? error.code : "assertion_failed";
  const message = error instanceof Error ? error.message : "unknown native integration failure";
  console.error(`PI_NATIVE_INTEGRATION_FAILED code=${code} message=${JSON.stringify(message)}`);
  process.exitCode = EXIT_CODES[code] ?? EXIT_CODES.assertion_failed;
}
