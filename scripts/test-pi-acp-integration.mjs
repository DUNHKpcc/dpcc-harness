#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const FIXTURE_PATH = path.resolve(SCRIPT_DIR, "fixtures/pi-rpc-fixture.mjs");
const RUNTIME_MANIFEST_PATH = path.resolve(SCRIPT_DIR, "pi-runtime-versions.json");
const TEST_TIER = "A";
const EXIT_CODES = {
  ok: 0,
  pi_acp_bundled_package_missing: 41,
  timeout: 42,
  child_exit: 43,
  protocol_error: 44,
  assertion_failed: 45,
  pi_acp_version_unsupported: 46,
};
const DEFAULT_TIMEOUT_MS = process.env.CI === "true" ? 90000 : 30000;
const TEST_TIMEOUT_MS = Number(process.env.PI_ACP_TEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const ACP_PROTOCOL_VERSION = 1;
const RETRY_ONLY_MARKER = "fixture:retry-only";
// These are the complete retry notices emitted by the reviewed pi-acp path.
// Do not treat arbitrary model text beginning with "Retry" as diagnostics.
const REVIEWED_RETRY_TEXTS = new Set([
  "Retrying...",
  "Retrying (attempt 1/3, waiting 2s)...",
  "Retry finished, resuming.",
]);

function nowIso() {
  return new Date().toISOString();
}

function safeBasename(filePath) {
  return path.basename(String(filePath ?? ""));
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

function resolveBundledAdapter(entry) {
  const hostPath = resolveHeadlessElectronHost(String(require("electron")));
  const entryPath = path.join(REPO_ROOT, "node_modules", ...entry.package.split("/"), entry.entry);
  try {
    fs.accessSync(hostPath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    fs.accessSync(entryPath, fs.constants.F_OK);
    return { hostPath, entryPath };
  } catch {
    return null;
  }
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function findPackageVersion(executable, packageName) {
  try {
    let directory = path.dirname(fs.realpathSync(executable));
    for (let depth = 0; depth < 8; depth += 1) {
      const packagePath = path.join(directory, "package.json");
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (packageJson.name === packageName && typeof packageJson.version === "string") {
          return packageJson.version;
        }
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

function readRuntimeManifest() {
  try {
    const manifest = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST_PATH, "utf8"));
    const entry = manifest?.binaries?.["pi-acp"];
    if (!entry
      || entry.package !== "pi-acp"
      || typeof entry.version !== "string"
      || entry.binary !== "pi-acp"
      || typeof entry.entry !== "string") {
      throw new Error("pi-acp runtime manifest entry is invalid");
    }
    return entry;
  } catch (error) {
    throw codedError(
      "pi_acp_version_unsupported",
      `Unable to validate pi-acp runtime manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function makeSummaryShell(summary) {
  return JSON.stringify(summary, null, 2);
}

function redactText(value, replacements) {
  let result = String(value ?? "");
  for (const replacement of replacements) {
    if (replacement) {
      result = result.split(replacement).join("<redacted>");
    }
  }
  return result;
}

function collectTextFromUpdate(update) {
  if (!update || typeof update !== "object") return "";
  if (update.sessionUpdate !== "agent_message_chunk") return "";
  const content = update.content;
  if (!content || typeof content !== "object") return "";
  if (typeof content.text !== "string") return "";
  return content.text;
}

function readStartupInfo(result) {
  const startupInfo = result?._meta?.piAcp?.startupInfo;
  return typeof startupInfo === "string" && startupInfo ? startupInfo : null;
}

function summarizeTurnText(textChunks) {
  return textChunks.join("").trim();
}

function createTimeout(ms, label) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(codedError("timeout", `${label} timed out after ${ms}ms`, { label, timeoutMs: ms }));
    }, ms);
  });
  return {
    promise,
    cancel() {
      if (timer) clearTimeout(timer);
    },
  };
}

async function mktempDir(prefix) {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function writeFile(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, contents, "utf8");
}

export async function createWorkspaceRoot() {
  const root = await mktempDir("harnss-pi-acp-");
  const home = path.join(root, "home");
  const agentDir = path.join(root, "pi-agent");
  const sessionDir = path.join(root, "pi-sessions");
  const workspace = path.join(root, "workspace");
  await Promise.all([home, agentDir, sessionDir, workspace].map(ensureDir));
  await writeFile(path.join(workspace, "README.md"), "# Fixture workspace\n");
  await writeFile(path.join(workspace, "AGENTS.md"), "# Fixture context\n");
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ quietStartup: false }, null, 2),
  );
  return { root, home, agentDir, sessionDir, workspace };
}

function buildIsolatedEnv(baseEnv, paths, fixtureMode) {
  const env = {
    ...baseEnv,
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: path.join(paths.root, "xdg-config"),
    XDG_DATA_HOME: path.join(paths.root, "xdg-data"),
    XDG_CACHE_HOME: path.join(paths.root, "xdg-cache"),
    PI_CODING_AGENT_DIR: paths.agentDir,
    PI_CODING_AGENT_SESSION_DIR: paths.sessionDir,
    PI_ACP_PI_COMMAND: FIXTURE_PATH,
    PI_RPC_FIXTURE_MODE: fixtureMode ?? "",
    ELECTRON_RUN_AS_NODE: "1",
  };
  return env;
}

export function spawnPiAcp(paths, fixtureMode) {
  const runtime = resolveBundledAdapter(readRuntimeManifest());
  if (!runtime) {
    return { missing: true };
  }

  const proc = spawn(runtime.hostPath, [runtime.entryPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: buildIsolatedEnv(process.env, paths, fixtureMode),
    cwd: paths.workspace,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const pending = new Map();
  const notifications = [];
  const sessionUpdates = [];
  const stderrLines = [];
  let buffer = "";
  let childExit = null;
  let childFailure = null;

  const rejectPending = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const terminate = (signal = "SIGTERM") => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    try {
      if (process.platform !== "win32" && typeof proc.pid === "number") process.kill(-proc.pid, signal);
      else proc.kill(signal);
    } catch {
      try { proc.kill(signal); } catch { /* already gone */ }
    }
  };

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          const protocolError = codedError(
            "protocol_error",
            `pi-acp returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
          childFailure = protocolError;
          rejectPending(protocolError);
          terminate("SIGKILL");
          return;
        }
        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
          const entry = pending.get(message.id);
          if (entry) {
            pending.delete(message.id);
            if (message.error) {
              entry.reject(codedError(
                "protocol_error",
                message.error.message || "ACP error",
                { error: message.error },
              ));
            } else {
              entry.resolve(message.result);
            }
          }
        } else {
          notifications.push(message);
          if (message.method === "session/update" && message.params?.update) {
            sessionUpdates.push(message.params.update);
          }
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
  proc.stderr.on("data", (chunk) => {
    stderrLines.push(String(chunk));
  });
  proc.stdin.on("error", (error) => {
    const childError = codedError("child_error", `pi-acp stdin failed: ${error.message}`);
    childFailure = childError;
    rejectPending(childError);
  });
  proc.on("error", (error) => {
    const childError = codedError("child_error", `pi-acp could not start: ${error.message}`);
    childFailure = childError;
    rejectPending(childError);
  });
  proc.on("exit", (code, signal) => {
    childExit = { code, signal };
    if (pending.size > 0) {
      const error = childFailure ?? codedError(
        "child_exit",
        `pi-acp exited before replying (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        { code, signal },
      );
      rejectPending(error);
    }
  });

  const request = (method, params, timeoutMs = TEST_TIMEOUT_MS) => {
    const id = crypto.randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const timeout = createTimeout(timeoutMs, method);
    return new Promise((resolve, reject) => {
      const pendingEntry = {
        resolve: (value) => {
          timeout.cancel();
          resolve(value);
        },
        reject: (error) => {
          timeout.cancel();
          reject(error);
        },
      };
      pending.set(id, pendingEntry);
      try {
        proc.stdin.write(`${payload}\n`, (error) => {
          if (!error || !pending.has(id)) return;
          const childError = codedError("child_error", `pi-acp stdin failed: ${error.message}`);
          childFailure = childError;
          pending.delete(id);
          reject(childError);
        });
      } catch (error) {
        pending.delete(id);
        reject(codedError("child_error", `pi-acp stdin failed: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      timeout.promise.catch((error) => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  };

  const notify = (method, params) => {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    proc.stdin.write(`${payload}\n`);
  };

  const close = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      try { proc.stdin.end(); } catch { /* already closed */ }
      terminate("SIGTERM");
    }
    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        terminate("SIGKILL");
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return {
    missing: false,
    proc,
    request,
    notify,
    notifications,
    sessionUpdates,
    stderrLines,
    childExit: () => childExit,
    close,
  };
}

export function buildClientCapabilities() {
  return {
    fs: {
      readTextFile: true,
      writeTextFile: true,
    },
    promptCapabilities: {
      embeddedContext: false,
      image: false,
    },
  };
}

function assertCondition(condition, code, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }
}

function stripRetryNotices(textChunks) {
  return textChunks.filter((chunk) => !REVIEWED_RETRY_TEXTS.has(chunk.trim()));
}

async function waitForCondition(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw codedError("timeout", `${label} timed out after ${timeoutMs}ms`, { label, timeoutMs });
}

async function waitForStartupInfo(connection, result) {
  const startupInfo = readStartupInfo(result);
  if (!startupInfo) return;
  await waitForCondition(
    () => connection.sessionUpdates.some((update) => collectTextFromUpdate(update) === startupInfo),
    "session startup info",
  );
}

async function initializeFixtureSession(connection, paths, clientName) {
  const initializeResult = await connection.request("initialize", {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientInfo: { name: clientName, version: "1.0.0" },
    clientCapabilities: buildClientCapabilities(),
  });
  assertCondition(
    initializeResult?.protocolVersion === ACP_PROTOCOL_VERSION,
    "protocol_error",
    `Expected protocol version ${ACP_PROTOCOL_VERSION}`,
    { initializeResult },
  );
  const session = await connection.request("session/new", {
    cwd: paths.workspace,
    mcpServers: [],
  });
  assertCondition(session?.sessionId, "protocol_error", "session/new did not return a sessionId", { session });
  await waitForStartupInfo(connection, session);
  return session;
}

async function runAcpScenario(paths, { mode, promptText, usePromptMarker = false, loadSessionId = null }) {
  const fixtureMode = usePromptMarker ? "" : mode;
  const connection = spawnPiAcp(paths, fixtureMode);
  if (connection.missing) {
    return { ok: false, code: "pi_acp_bundled_package_missing" };
  }

  const safePaths = [paths.home, paths.agentDir, paths.sessionDir, paths.workspace, FIXTURE_PATH];
  const summary = {
    startedAt: nowIso(),
    tier: TEST_TIER,
    mode,
    usePromptMarker,
    workspace: safeBasename(paths.workspace),
    fixture: safeBasename(FIXTURE_PATH),
  };

  try {
    const initializeResult = await connection.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: {
        name: "harness",
        version: "1.0.0",
      },
      clientCapabilities: buildClientCapabilities(),
    });

    assertCondition(
      initializeResult?.protocolVersion === ACP_PROTOCOL_VERSION,
      "protocol_error",
      `Expected protocol version ${ACP_PROTOCOL_VERSION}`,
      { initializeResult },
    );

    const newSessionResult = await connection.request("session/new", {
      cwd: paths.workspace,
      mcpServers: [],
    });
    assertCondition(newSessionResult?.sessionId, "protocol_error", "session/new did not return a sessionId", { newSessionResult });
    await waitForStartupInfo(connection, newSessionResult);

    const sessionId = loadSessionId ?? newSessionResult.sessionId;
    const turnUpdateStart = connection.sessionUpdates.length;
    const promptResult = await connection.request("session/prompt", {
      sessionId,
      prompt: [
        {
          type: "text",
          text: promptText,
        },
      ],
    });

    const turnUpdates = connection.sessionUpdates.slice(turnUpdateStart);
    const rawAssistantChunks = turnUpdates.map(collectTextFromUpdate).filter(Boolean);
    const visibleAssistantChunks = stripRetryNotices(rawAssistantChunks);
    const visibleAssistantText = summarizeTurnText(visibleAssistantChunks);
    const rawAssistantText = summarizeTurnText(rawAssistantChunks);
    const retryNoticeCount = rawAssistantChunks.filter((chunk) => REVIEWED_RETRY_TEXTS.has(chunk.trim())).length;

    const protocolShape = mode === "retry-only"
      ? "retry_diagnostics_only"
      : visibleAssistantText.length > 0
        ? "visible_assistant_output"
        : "no_visible_output";
    if (mode === "retry-then-success") {
      assertCondition(
        !/^Retry/i.test(visibleAssistantText),
        "assertion_failed",
        "Retry text leaked into the visible assistant answer.",
        { visibleAssistantText, rawAssistantText },
      );
    }

    if (mode === "normal") {
      assertCondition(
        promptResult?.stopReason === "end_turn",
        "assertion_failed",
        "normal mode did not finish with stopReason=end_turn",
        { promptResult },
      );
    }

    if (mode === "retry-only") {
      assertCondition(
        promptResult?.stopReason === "end_turn",
        "assertion_failed",
        "retry-only mode did not return stopReason=end_turn",
        { promptResult },
      );
      assertCondition(
        retryNoticeCount > 0,
        "assertion_failed",
        "retry-only mode did not surface retry diagnostics",
        { rawAssistantChunks, rawAssistantText },
      );
      assertCondition(
        visibleAssistantText.length === 0,
        "assertion_failed",
        "retry-only mode unexpectedly produced visible assistant text",
        { visibleAssistantText, rawAssistantText },
      );
    }

    if (mode === "retry-then-success") {
      assertCondition(
        promptResult?.stopReason === "end_turn",
        "assertion_failed",
        "retry-then-success did not finish with stopReason=end_turn",
        { promptResult },
      );
      assertCondition(
        visibleAssistantText.length > 0,
        "assertion_failed",
        "retry-then-success did not yield a visible assistant answer",
        { visibleAssistantText, rawAssistantText },
      );
    }

    const loadReplay = {
      initializeResult,
      newSessionResult,
      promptResult,
      sessionId,
      retryNoticeCount,
      rawAssistantText,
      visibleAssistantText,
      notifications: connection.notifications.slice(-12),
      stderrTail: redactText(connection.stderrLines.join(""), safePaths),
      childExit: connection.childExit(),
    };

    await connection.close();

    return {
      ok: true,
      code: null,
      protocolShape,
      summary: loadReplay,
    };
  } catch (error) {
    await connection.close().catch(() => {});
    return {
      ok: false,
      code: error?.code || "protocol_error",
      error: {
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? null,
      },
      summary: {
        notifications: connection.notifications.slice(-12),
        stderrTail: redactText(connection.stderrLines.join(""), safePaths),
        childExit: connection.childExit(),
      },
    };
  }
}

async function runCancelScenario(paths) {
  const connection = spawnPiAcp(paths, "hold");
  if (connection.missing) return { ok: false, code: "pi_acp_bundled_package_missing" };

  try {
    const session = await initializeFixtureSession(connection, paths, "cancel-harness");
    const prompt = connection.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "fixture:hold wait for cancellation" }],
    }, 5_000);
    await waitForCondition(
      () => connection.sessionUpdates.some((update) => (
        update?.sessionUpdate === "tool_call" && update?.status === "in_progress"
      )),
      "in-flight fixture tool",
    );
    connection.notify("session/cancel", { sessionId: session.sessionId });
    const promptResult = await prompt;
    assertCondition(
      promptResult?.stopReason === "cancelled",
      "assertion_failed",
      "session/cancel did not settle the real adapter prompt as cancelled",
      { promptResult },
    );
    await connection.close();
    assertCondition(
      connection.childExit() !== null,
      "child_exit",
      "pi-acp child did not exit after stop cleanup",
    );
    return {
      ok: true,
      code: null,
      protocolShape: "cancelled",
      summary: {
        sessionId: session.sessionId,
        stopReason: promptResult.stopReason,
        childExit: connection.childExit(),
      },
    };
  } catch (error) {
    await connection.close().catch(() => {});
    return {
      ok: false,
      code: error?.code || "protocol_error",
      error: { message: error instanceof Error ? error.message : String(error) },
      summary: { childExit: connection.childExit() },
    };
  }
}

async function runTimeoutScenario(paths) {
  const connection = spawnPiAcp(paths, "hold");
  if (connection.missing) return { ok: false, code: "pi_acp_bundled_package_missing" };

  try {
    const session = await initializeFixtureSession(connection, paths, "timeout-harness");
    let timeoutError;
    try {
      await connection.request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "fixture:hold remain unresponsive" }],
      }, 300);
    } catch (error) {
      timeoutError = error;
    }
    assertCondition(
      timeoutError?.code === "timeout",
      "assertion_failed",
      "an unresponsive real adapter prompt did not produce the timeout code",
      { timeoutCode: timeoutError?.code },
    );
    await connection.close();
    assertCondition(
      connection.childExit() !== null,
      "child_exit",
      "timed-out pi-acp child did not exit during cleanup",
    );
    return {
      ok: true,
      code: null,
      protocolShape: "transport_timeout",
      summary: {
        sessionId: session.sessionId,
        timeoutCode: timeoutError.code,
        childExit: connection.childExit(),
      },
    };
  } catch (error) {
    await connection.close().catch(() => {});
    return {
      ok: false,
      code: error?.code || "protocol_error",
      error: { message: error instanceof Error ? error.message : String(error) },
      summary: { childExit: connection.childExit() },
    };
  }
}

async function runLoadSessionCheck(paths, sessionId) {
  const connection = spawnPiAcp(paths, "normal");
  if (connection.missing) {
    return { ok: false, code: "pi_acp_bundled_package_missing" };
  }

  try {
    await connection.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: {
        name: "harness",
        version: "1.0.0",
      },
      clientCapabilities: buildClientCapabilities(),
    });

    const loadResult = await connection.request("session/load", {
      sessionId,
      cwd: paths.workspace,
      mcpServers: [],
    });

    assertCondition(loadResult !== undefined, "protocol_error", "session/load returned no result", { loadResult });
    const replayNotificationCount = connection.notifications.length;
    const replaySessionUpdateCount = connection.sessionUpdates.length;
    connection.notifications.length = 0;
    connection.sessionUpdates.length = 0;

    const promptResult = await connection.request("session/prompt", {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "follow up after load",
        },
      ],
    });

    assertCondition(
      promptResult?.stopReason === "end_turn",
      "assertion_failed",
      "prompt after load did not settle with stopReason=end_turn",
      { promptResult },
    );

    const rawAssistantChunks = connection.sessionUpdates.map(collectTextFromUpdate).filter(Boolean);
    const visibleAssistantText = summarizeTurnText(stripRetryNotices(rawAssistantChunks));
    assertCondition(
      visibleAssistantText.length > 0,
      "assertion_failed",
      "session/load did not produce any visible assistant text after follow-up prompt",
      { rawAssistantChunks, replayNotificationCount, replaySessionUpdateCount },
    );

    const result = {
      ok: true,
      code: null,
      tier: TEST_TIER,
      summary: {
        loadResult,
        promptResult,
        sessionId,
        visibleAssistantText,
        replayNotificationCount,
        replaySessionUpdateCount,
        notifications: connection.notifications.slice(-12),
        stderrTail: redactText(connection.stderrLines.join(""), [paths.home, paths.agentDir, paths.sessionDir, paths.workspace, FIXTURE_PATH]),
        childExit: connection.childExit(),
      },
    };
    await connection.close();
    return result;
  } catch (error) {
    await connection.close().catch(() => {});
    return {
      ok: false,
      code: error?.code || "protocol_error",
      error: {
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? null,
      },
      summary: {
        notifications: connection.notifications.slice(-12),
        stderrTail: redactText(connection.stderrLines.join(""), [paths.home, paths.agentDir, paths.sessionDir, paths.workspace, FIXTURE_PATH]),
        childExit: connection.childExit(),
      },
    };
  }
}

async function main() {
  let runtimeManifest;
  try {
    runtimeManifest = readRuntimeManifest();
  } catch (error) {
    const failure = {
      ok: false,
      code: error?.code || "pi_acp_version_unsupported",
      tier: TEST_TIER,
      summary: {
        fixture: safeBasename(FIXTURE_PATH),
        manifest: safeBasename(RUNTIME_MANIFEST_PATH),
        timeoutMs: TEST_TIMEOUT_MS,
      },
      error: { message: error instanceof Error ? error.message : String(error) },
    };
    process.stdout.write(`${makeSummaryShell(failure)}\n`);
    process.exitCode = EXIT_CODES.pi_acp_version_unsupported;
    return;
  }

  const bundledAdapter = resolveBundledAdapter(runtimeManifest);
  if (!bundledAdapter) {
    const failure = {
      ok: false,
      code: "pi_acp_bundled_package_missing",
      tier: TEST_TIER,
      summary: {
        fixture: safeBasename(FIXTURE_PATH),
        expectedSource: "bundled",
        expectedVersion: runtimeManifest.version,
        timeoutMs: TEST_TIMEOUT_MS,
        ci: process.env.CI === "true",
      },
    };
    process.stdout.write(`${makeSummaryShell(failure)}\n`);
    process.exitCode = EXIT_CODES.pi_acp_bundled_package_missing;
    return;
  }

  const piAcpPath = bundledAdapter.entryPath;
  const actualPiAcpVersion = findPackageVersion(piAcpPath, runtimeManifest.package);
  if (!actualPiAcpVersion || actualPiAcpVersion !== runtimeManifest.version) {
    const failure = {
      ok: false,
      code: "pi_acp_version_unsupported",
      tier: TEST_TIER,
      summary: {
        fixture: safeBasename(FIXTURE_PATH),
        piAcp: safeBasename(piAcpPath),
        expectedVersion: runtimeManifest.version,
        actualVersion: actualPiAcpVersion,
        manifest: safeBasename(RUNTIME_MANIFEST_PATH),
      },
    };
    process.stdout.write(`${makeSummaryShell(failure)}\n`);
    process.exitCode = EXIT_CODES.pi_acp_version_unsupported;
    return;
  }

  const paths = await createWorkspaceRoot();
  const results = [];
  let exitCode = EXIT_CODES.ok;

  try {
    const normalResult = await runAcpScenario(paths, {
      mode: "normal",
      promptText: "normal fixture prompt",
      usePromptMarker: false,
    });
    results.push({ scenario: "normal", ...normalResult });
    if (!normalResult.ok) throw Object.assign(new Error(normalResult.error?.message ?? "normal failed"), { code: normalResult.code });

    const loadResult = await runLoadSessionCheck(paths, normalResult.summary.sessionId);
    results.push({ scenario: "load", ...loadResult });
    if (!loadResult.ok) throw Object.assign(new Error(loadResult.error?.message ?? "load failed"), { code: loadResult.code });

    const retryOnlyResult = await runAcpScenario(paths, {
      mode: "retry-only",
      promptText: `${RETRY_ONLY_MARKER} trigger retry-only`,
      usePromptMarker: true,
    });
    results.push({ scenario: "retry-only", ...retryOnlyResult });
    if (!retryOnlyResult.ok) throw Object.assign(new Error(retryOnlyResult.error?.message ?? "retry-only failed"), { code: retryOnlyResult.code });

    const retryThenSuccessResult = await runAcpScenario(paths, {
      mode: "retry-then-success",
      promptText: "retry-then-success fixture prompt",
      usePromptMarker: false,
    });
    results.push({ scenario: "retry-then-success", ...retryThenSuccessResult });
    if (!retryThenSuccessResult.ok) throw Object.assign(new Error(retryThenSuccessResult.error?.message ?? "retry-then-success failed"), { code: retryThenSuccessResult.code });

    const cancelResult = await runCancelScenario(paths);
    results.push({ scenario: "cancel", ...cancelResult });
    if (!cancelResult.ok) throw Object.assign(new Error(cancelResult.error?.message ?? "cancel failed"), { code: cancelResult.code });

    const timeoutResult = await runTimeoutScenario(paths);
    results.push({ scenario: "timeout", ...timeoutResult });
    if (!timeoutResult.ok) throw Object.assign(new Error(timeoutResult.error?.message ?? "timeout failed"), { code: timeoutResult.code });

    const summary = {
      ok: true,
      code: null,
      tier: TEST_TIER,
      timeoutMs: TEST_TIMEOUT_MS,
      ci: process.env.CI === "true",
      piAcp: safeBasename(piAcpPath),
      piAcpSource: "bundled",
      piAcpVersion: actualPiAcpVersion,
      fixture: safeBasename(FIXTURE_PATH),
      scenarios: results.map(({ scenario, ok, protocolShape, code, summary: scenarioSummary }) => ({
        scenario,
        ok,
        protocolShape: protocolShape ?? null,
        code: code ?? null,
        sessionId: scenarioSummary?.sessionId ? String(scenarioSummary.sessionId).slice(0, 8) : null,
        visibleAssistantText: scenarioSummary?.visibleAssistantText ?? null,
        retryNoticeCount: scenarioSummary?.retryNoticeCount ?? null,
        stopReason: scenarioSummary?.stopReason ?? null,
        timeoutCode: scenarioSummary?.timeoutCode ?? null,
        childExit: scenarioSummary?.childExit ?? null,
      })),
    };
    process.stdout.write(`${makeSummaryShell(summary)}\n`);
  } catch (error) {
    const code = error?.code || "protocol_error";
    exitCode = EXIT_CODES[code] ?? EXIT_CODES.protocol_error;
    const failure = {
      ok: false,
      code,
      tier: TEST_TIER,
      timeoutMs: TEST_TIMEOUT_MS,
      ci: process.env.CI === "true",
      fixture: safeBasename(FIXTURE_PATH),
      scenarioResults: results.map(({ scenario, ok, protocolShape, code: scenarioCode, error: scenarioError, summary: scenarioSummary }) => ({
        scenario,
        ok,
        protocolShape: protocolShape ?? null,
        code: scenarioCode ?? null,
        error: scenarioError ?? null,
        sessionId: scenarioSummary?.sessionId ? String(scenarioSummary.sessionId).slice(0, 8) : null,
        visibleAssistantText: scenarioSummary?.visibleAssistantText ?? null,
        retryNoticeCount: scenarioSummary?.retryNoticeCount ?? null,
        childExit: scenarioSummary?.childExit ?? null,
      })),
      error: {
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? null,
      },
    };
    process.stdout.write(`${makeSummaryShell(failure)}\n`);
  }

  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = EXIT_CODES.protocol_error;
  });
}
