import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeInterruptedSession,
  type RecoverablePersistedSession,
  type RecoverableRequestRecord,
  type RecoverableSessionMessage,
} from "@shared/lib/session-recovery";

export type AcpRecoveryPhase = "first" | "resume";
export type AcpRecoveryScenario = "success" | "crash" | "timeout" | "child-exit" | "stop-active";

export interface AcpRecoveryE2EConfig {
  enabled: boolean;
  mode: "acp-recovery";
  phase: AcpRecoveryPhase;
  scenario: AcpRecoveryScenario;
  resultPath: string;
  userDataPath: string;
  homePath: string;
  projectPath: string;
  workspaceRoot: string;
  projectId: string;
  sessionId?: string;
  agentSessionId?: string;
}

export interface AcpRecoveryRuntimeSnapshot {
  internalId: string;
  agentSessionId?: string;
  pid?: number;
  activeUserPrompts: number;
  currentTurnId?: string;
  isOfficialPi: boolean;
  adapterVersion?: string;
  piVersion?: string;
}

const E2E_MODE = "acp-recovery";
const E2E_RESULT_CHANNEL = "harnss:e2e:write-result";
const E2E_CONFIG_CHANNEL = "harnss:e2e:get-config";
const E2E_SNAPSHOT_CHANNEL = "harnss:e2e:runtime-snapshot";
const E2E_TERMINATE_RUNTIME_CHANNEL = "harnss:e2e:terminate-runtime";
const E2E_NORMALIZE_SESSION_CHANNEL = "harnss:e2e:normalize-session";
const E2E_SHUTDOWN_CHANNEL = "harnss:e2e:shutdown";

function readArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Read the explicit test-only mode without making normal app startup test-aware. */
export function readAcpRecoveryE2EConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): AcpRecoveryE2EConfig | null {
  const mode = nonEmpty(env.HARNSS_E2E_MODE ?? readArg(argv, "--test-mode"), "");
  if (mode !== E2E_MODE) return null;

  const phaseValue = nonEmpty(env.HARNSS_E2E_PHASE ?? readArg(argv, "--test-phase"), "first");
  const scenarioValue = nonEmpty(env.HARNSS_E2E_SCENARIO ?? readArg(argv, "--test-scenario"), "success");
  const phase: AcpRecoveryPhase = phaseValue === "resume" ? "resume" : "first";
  const scenario: AcpRecoveryScenario = scenarioValue === "crash"
    || scenarioValue === "timeout"
    || scenarioValue === "child-exit"
    || scenarioValue === "stop-active"
    ? scenarioValue
    : "success";

  return {
    enabled: true,
    mode: E2E_MODE,
    phase,
    scenario,
    resultPath: nonEmpty(env.HARNSS_E2E_RESULT_PATH ?? readArg(argv, "--test-result-path"), path.join(process.cwd(), "e2e-result.json")),
    userDataPath: nonEmpty(env.HARNSS_E2E_USER_DATA, path.join(process.cwd(), ".e2e-user-data")),
    homePath: nonEmpty(env.HARNSS_E2E_HOME, process.env.HOME ?? process.cwd()),
    projectPath: nonEmpty(env.HARNSS_E2E_PROJECT_DIR, process.cwd()),
    workspaceRoot: nonEmpty(env.HARNSS_E2E_WORKSPACE_DIR, process.cwd()),
    projectId: nonEmpty(env.HARNSS_E2E_PROJECT_ID, "e2e-project"),
    ...(env.HARNSS_E2E_SESSION_ID ? { sessionId: env.HARNSS_E2E_SESSION_ID } : {}),
    ...(env.HARNSS_E2E_AGENT_SESSION_ID ? { agentSessionId: env.HARNSS_E2E_AGENT_SESSION_ID } : {}),
  };
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, filePath);
}

function assertSender(event: Electron.IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("E2E IPC request did not originate from the main renderer.");
  }
}

/** Register only the IPC surface used by the explicit recovery test mode. */
export function registerAcpRecoveryIpc(
  config: AcpRecoveryE2EConfig,
  getMainWindow: () => BrowserWindow | null,
  getRuntimeSnapshot: () => AcpRecoveryRuntimeSnapshot[],
  terminateRuntime: (internalId: string) => boolean,
  stopRuntime: () => void,
): void {
  if (!config.enabled) return;

  ipcMain.handle(E2E_CONFIG_CHANNEL, (event) => {
    assertSender(event, getMainWindow);
    return config;
  });

  ipcMain.handle(E2E_RESULT_CHANNEL, (event, result: unknown) => {
    assertSender(event, getMainWindow);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("E2E result must be a JSON object.");
    }
    writeJsonAtomically(config.resultPath, {
      ...(result as Record<string, unknown>),
      mode: config.mode,
      phase: config.phase,
      scenario: config.scenario,
      writtenAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  ipcMain.handle(E2E_SNAPSHOT_CHANNEL, (event) => {
    assertSender(event, getMainWindow);
    return getRuntimeSnapshot();
  });

  ipcMain.handle(E2E_TERMINATE_RUNTIME_CHANNEL, (event, internalId: unknown) => {
    assertSender(event, getMainWindow);
    if (typeof internalId !== "string" || !internalId.trim()) return false;
    return terminateRuntime(internalId.trim());
  });

  ipcMain.handle(E2E_NORMALIZE_SESSION_CHANNEL, (event, value: unknown) => {
    assertSender(event, getMainWindow);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("E2E session payload must be a JSON object.");
    }
    const session = value as RecoverablePersistedSession<
      RecoverableSessionMessage,
      RecoverableRequestRecord
    >;
    if (!Array.isArray(session.messages)) {
      throw new Error("E2E session payload is missing messages.");
    }
    return normalizeInterruptedSession(session);
  });

  ipcMain.handle(E2E_SHUTDOWN_CHANNEL, (event, exitCode: unknown = 0) => {
    assertSender(event, getMainWindow);
    const normalizedCode = typeof exitCode === "number" && Number.isInteger(exitCode)
      ? Math.max(0, Math.min(255, exitCode))
      : 0;
    stopRuntime();
    setImmediate(() => app.exit(normalizedCode));
    return { ok: true };
  });
}

function serializedConfig(config: AcpRecoveryE2EConfig): string {
  return JSON.stringify(config).replace(/</g, "\\u003c");
}

/**
 * Small real renderer used by the recovery E2E. It talks to the production
 * preload/API and deliberately avoids React so failures stay at the process
 * and persistence boundary rather than in UI test helpers.
 */
export function buildAcpRecoveryRendererUrl(config: AcpRecoveryE2EConfig): string {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>ACP recovery E2E</title></head>
<body><main id="status">ACP recovery test running</main>
<script>
(() => {
  const config = ${serializedConfig(config)};
  const api = window.claude;
  const e2e = window.__harnssE2e;
  const state = { updates: [], completions: [], transports: [], exits: [], requests: [] };
  const RETRY_TEXT = /^(?:Retrying\\.\\.\\.|Retrying\\s*\\(attempt\\s+\\d+\\/\\d+,\\s*waiting\\s+\\d+s\\)\\.\\.\\.|Retry finished,\\s*resuming\\.)$/i;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (update) => update && update.sessionUpdate === "agent_message_chunk"
    && update.content && typeof update.content.text === "string" ? update.content.text : "";
  const visibleText = () => state.updates.map(textOf).filter(Boolean).filter((text) => !RETRY_TEXT.test(text)).join("").trim();
  const waitFor = async (predicate, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await delay(25);
    }
    throw new Error("Timed out waiting for " + label);
  };
  const latestCompletion = (sessionId) => state.completions.slice().reverse().find((item) => item._sessionId === sessionId);
  const latestRequestRecords = () => {
    const records = new Map();
    for (const event of state.requests) {
      if (event && event.record && event.record.id) records.set(event.record.id, event.record);
    }
    return Array.from(records.values());
  };
  const snapshotFor = async (sessionId) => {
    const snapshots = await e2e.runtimeSnapshot();
    return snapshots.find((item) => item.internalId === sessionId) || null;
  };
  const resetTurnState = () => {
    state.updates.length = 0;
    state.completions.length = 0;
    state.transports.length = 0;
    state.exits.length = 0;
    state.requests.length = 0;
  };
  const saveSession = async (session) => {
    const result = await api.sessions.save(session, { restoreDeleted: true });
    if (result && result.error) throw new Error(result.error);
    const loaded = await api.sessions.load(session.projectId, session.id);
    if (!loaded) throw new Error("Persisted session could not be loaded after save.");
    return loaded;
  };
  const baseSession = (sessionId, agentSessionId, messages, requestLog, isProcessing) => ({
    id: sessionId,
    projectId: config.projectId,
    title: "ACP recovery E2E",
    createdAt: Date.now(),
    messages,
    engine: "acp",
    agentId: "pi-acp",
    agentSessionId,
    model: "fixture/fixture-mini",
    permissionMode: "default",
    totalCost: 0,
    upstreamRequestCount: requestLog.length,
    requestLog,
    isProcessing,
  });
  const userMessage = (content) => ({ id: "e2e-user-" + Date.now(), role: "user", content, timestamp: Date.now() });
  const assistantMessage = (content) => ({ id: "e2e-assistant-" + Date.now(), role: "assistant", content, timestamp: Date.now(), isStreaming: false });
  const startAndAttach = async (agentSessionId) => {
    let result;
    if (config.phase === "resume") {
      result = await api.acp.reviveSession({
        agentId: "pi-acp",
        cwd: config.projectPath,
        sessionId: config.sessionId,
        agentSessionId,
        mcpServers: [],
      });
    } else {
      result = await api.acp.start({ agentId: "pi-acp", cwd: config.projectPath, mcpServers: [] });
    }
    if (!result || result.error || !result.sessionId) {
      throw new Error((result && result.error) || "ACP session did not start or revive.");
    }
    const attach = await api.acp.attachRenderer(result.sessionId);
    if (attach && attach.error) throw new Error(attach.error);
    return result;
  };

  const assertPiRuntimeStatus = async () => {
    const runtimeStatus = await api.agents.getPiRuntimeStatus();
    if (runtimeStatus?.source !== "bundled" || runtimeStatus.offlineReady !== true) {
      throw new Error("Pi runtime status IPC did not report an offline-ready bundled runtime.");
    }
    for (const status of [
      runtimeStatus && runtimeStatus.pi,
      runtimeStatus && runtimeStatus.piAcp,
      runtimeStatus && runtimeStatus.piMcpAdapter,
    ]) {
      if (!status || status.status !== "ok" || !status.resolvedPath || !status.actualVersion) {
        throw new Error("Pi runtime status IPC did not report a compatible bundled entry.");
      }
    }
  };

  const runFirstSuccess = async () => {
    const started = await startAndAttach();
    resetTurnState();
    const promptResult = await api.acp.prompt(started.sessionId, "fixture:normal e2e success");
    const completion = await waitFor(() => latestCompletion(started.sessionId), "completed turn");
    if (completion.status !== "completed" || !promptResult || promptResult.ok !== true) {
      throw new Error("The successful turn did not produce a completed canonical outcome.");
    }
    const answer = visibleText();
    if (!answer || state.updates.some((update) => RETRY_TEXT.test(textOf(update)))) {
      throw new Error("The successful turn did not produce clean assistant content.");
    }
    await delay(25);
    const requestLog = latestRequestRecords();
    if (!requestLog.some((record) => record.status === "completed" && typeof record.turnId === "string" && record.turnId)) {
      throw new Error("The successful turn did not persist a completed request correlated to its turn.");
    }
    const persisted = await saveSession(baseSession(
      started.sessionId,
      started.agentSessionId,
      [userMessage("fixture:normal e2e success"), assistantMessage(answer)],
      requestLog,
      false,
    ));
    if (persisted.engine !== "acp" || persisted.agentId !== "pi-acp" || persisted.agentSessionId !== started.agentSessionId) {
      throw new Error("Persisted success session identity is not ACP/Pi.");
    }
    const runtime = await snapshotFor(started.sessionId);
    if (!runtime || !runtime.pid) throw new Error("No live ACP child was observed for the success phase.");
    await e2e.writeResult({
      ok: false,
      code: "ready_for_restart",
      stage: "first-success",
      sessionId: started.sessionId,
      agentSessionId: started.agentSessionId,
      first: { runtime, persistedMessageCount: persisted.messages.length, requestLog },
    });
  };

  const runFirstCrash = async () => {
    const started = await startAndAttach();
    resetTurnState();
    const pendingPrompt = api.acp.prompt(started.sessionId, "fixture:hold e2e crash").catch(() => null);
    const toolCall = await waitFor(() => state.updates.find((update) => update.sessionUpdate === "tool_call" && update.status === "in_progress"), "in-flight tool call");
    const runtime = await waitFor(() => snapshotFor(started.sessionId), "active ACP runtime");
    if (!runtime || !runtime.pid || !runtime.currentTurnId || runtime.activeUserPrompts < 1) {
      throw new Error("Crash phase did not observe an active child and turn.");
    }
    const requestLog = latestRequestRecords();
    if (!requestLog.some((record) => record.status === "pending" && typeof record.turnId === "string" && record.turnId)) {
      throw new Error("Crash phase did not persist a pending request correlated to its turn.");
    }
    const pendingTool = {
      id: toolCall.toolCallId || "e2e-tool",
      role: "tool_call",
      content: toolCall.title || "fixture tool",
      timestamp: Date.now(),
      toolName: toolCall.title || "fixture_tool",
      toolInput: toolCall.rawInput || {},
      isStreaming: true,
    };
    await saveSession(baseSession(
      started.sessionId,
      started.agentSessionId,
      [userMessage("fixture:hold e2e crash"), pendingTool],
      requestLog,
      true,
    ));
    void pendingPrompt;
    await e2e.writeResult({
      ok: false,
      code: "ready_for_crash",
      stage: "first-crash",
      sessionId: started.sessionId,
      agentSessionId: started.agentSessionId,
      first: { runtime, pendingToolId: pendingTool.id, requestLog },
    });
  };

  const runFirstTimeout = async () => {
    const started = await startAndAttach();
    const runtime = await snapshotFor(started.sessionId);
    if (!runtime || !runtime.pid) throw new Error("Timeout phase did not observe a live ACP child.");
    resetTurnState();
    const promptResult = await api.acp.prompt(started.sessionId, "fixture:exit-nonzero e2e timeout");
    const transport = await waitFor(
      () => state.transports.find((event) => event._sessionId === started.sessionId),
      "prompt transport timeout",
    );
    if (!promptResult || promptResult.ok !== false || promptResult.status !== "transport_error"
      || promptResult.error?.code !== "acp_prompt_timeout"
      || transport.error?.code !== "acp_prompt_timeout") {
      throw new Error("A silent Pi child exit did not become acp_prompt_timeout.");
    }
    const requestLog = await waitFor(() => {
      const records = latestRequestRecords();
      return records.some((record) => record.status === "failed" && record.errorCode === "acp_prompt_timeout")
        ? records
        : null;
    }, "failed timeout request record");
    await waitFor(
      () => state.exits.find((event) => event._sessionId === started.sessionId),
      "timeout child exit",
    );
    const remainingRuntime = await e2e.runtimeSnapshot();
    if (remainingRuntime.some((item) => item.internalId === started.sessionId)) {
      throw new Error("Timed-out ACP child remained registered after process exit.");
    }
    if (visibleText() || state.completions.length > 0) {
      throw new Error("Transport timeout leaked assistant content or a successful terminal outcome.");
    }
    await e2e.writeResult({
      ok: true,
      code: "ok",
      stage: "first-timeout",
      sessionId: started.sessionId,
      agentSessionId: started.agentSessionId,
      first: { runtime, promptResult, transport, requestLog, remainingRuntime },
    });
    await e2e.shutdown(0);
  };

  const runFirstChildExit = async () => {
    const started = await startAndAttach();
    const runtime = await snapshotFor(started.sessionId);
    if (!runtime || !runtime.pid) throw new Error("Child-exit phase did not observe a live ACP child.");
    resetTurnState();
    const pendingPrompt = api.acp.prompt(started.sessionId, "fixture:hold e2e child exit");
    await waitFor(
      () => state.updates.find((update) => update.sessionUpdate === "tool_call" && update.status === "in_progress"),
      "in-flight child-exit tool",
    );
    if (await e2e.terminateRuntime(started.sessionId) !== true) {
      throw new Error("Test harness could not terminate the active ACP child.");
    }
    const promptResult = await pendingPrompt;
    const transport = await waitFor(
      () => state.transports.find((event) => event._sessionId === started.sessionId),
      "ACP child-exit transport error",
    );
    if (!promptResult || promptResult.ok !== false || promptResult.status !== "transport_error"
      || promptResult.error?.code !== "acp_child_exit"
      || transport.error?.code !== "acp_child_exit") {
      throw new Error("ACP process exit did not become acp_child_exit.");
    }
    const requestLog = await waitFor(() => {
      const records = latestRequestRecords();
      return records.some((record) => record.status === "failed" && record.errorCode === "acp_child_exit")
        ? records
        : null;
    }, "failed child-exit request record");
    await waitFor(
      () => state.exits.find((event) => event._sessionId === started.sessionId),
      "ACP child exit event",
    );
    const remainingRuntime = await e2e.runtimeSnapshot();
    if (remainingRuntime.some((item) => item.internalId === started.sessionId)
      || visibleText() || state.completions.length > 0) {
      throw new Error("ACP child exit leaked runtime state, assistant content or a successful outcome.");
    }
    await e2e.writeResult({
      ok: true,
      code: "ok",
      stage: "first-child-exit",
      sessionId: started.sessionId,
      agentSessionId: started.agentSessionId,
      first: { runtime, promptResult, transport, requestLog, remainingRuntime },
    });
    await e2e.shutdown(0);
  };

  const runFirstActiveStop = async () => {
    const started = await startAndAttach();
    const runtime = await snapshotFor(started.sessionId);
    if (!runtime || !runtime.pid) throw new Error("Active-stop phase did not observe a live ACP child.");
    resetTurnState();
    const pendingPrompt = api.acp.prompt(started.sessionId, "fixture:hold e2e active stop");
    await waitFor(
      () => state.updates.find((update) => update.sessionUpdate === "tool_call" && update.status === "in_progress"),
      "in-flight active-stop tool",
    );
    const stop = await api.acp.stop(started.sessionId);
    if (stop && stop.error) throw new Error(stop.error);
    const promptResult = await pendingPrompt;
    const completion = await waitFor(
      () => latestCompletion(started.sessionId),
      "active-stop cancelled outcome",
    );
    if (!promptResult || promptResult.ok !== true
      || promptResult.outcome?.status !== "cancelled"
      || completion.status !== "cancelled"
      || state.transports.length > 0) {
      throw new Error("Stopping an active ACP session did not settle its prompt as cancelled.");
    }
    const requestLog = await waitFor(() => {
      const records = latestRequestRecords();
      return records.some((record) => record.status === "cancelled" && record.errorCode === "acp_cancelled")
        ? records
        : null;
    }, "cancelled active-stop request record");
    const remainingRuntime = await e2e.runtimeSnapshot();
    if (remainingRuntime.some((item) => item.internalId === started.sessionId) || visibleText()) {
      throw new Error("Stopping an active ACP session leaked runtime state or assistant content.");
    }
    await e2e.writeResult({
      ok: true,
      code: "ok",
      stage: "first-stop-active",
      sessionId: started.sessionId,
      agentSessionId: started.agentSessionId,
      first: { runtime, promptResult, completion, requestLog, remainingRuntime },
    });
    await e2e.shutdown(0);
  };

  const runResume = async () => {
    if (!config.sessionId || !config.agentSessionId) throw new Error("Resume phase is missing session identity.");
    const persisted = await api.sessions.load(config.projectId, config.sessionId);
    if (!persisted) throw new Error("Persisted session is missing before resume.");
    if (persisted.engine !== "acp" || persisted.agentId !== "pi-acp" || persisted.agentSessionId !== config.agentSessionId) {
      throw new Error("Persisted resume identity is not ACP/Pi.");
    }
    const pending = (persisted.messages || []).filter((message) => message.role === "tool_call" && !message.toolResult && !message.toolError);
    if (config.scenario === "crash" && pending.length === 0) {
      throw new Error("Crash fixture did not leave an unfinished tool in persisted history.");
    }
    if (config.scenario === "success" && pending.length > 0) {
      throw new Error("Successful restart fixture unexpectedly persisted an unfinished tool.");
    }
    const recovered = await e2e.normalizeSession(persisted);
    const recoveredPending = (recovered.messages || []).filter((message) => message.role === "tool_call" && !message.toolResult && !message.toolError);
    if (recoveredPending.length > 0 || recovered.isProcessing === true) {
      throw new Error("Production restart normalization left runtime-only session state active.");
    }
    if (config.scenario === "crash" && !(recovered.requestLog || []).some((record) => record.status === "failed" && record.errorCode === "app_restart_interrupted")) {
      throw new Error("Production restart normalization did not fail the interrupted request.");
    }
    const revived = await startAndAttach(config.agentSessionId);
    if (revived.sessionId !== config.sessionId || revived.agentSessionId !== config.agentSessionId || revived.usedLoad !== true) {
      throw new Error("Resume did not preserve the internal/agent session identity with session/load.");
    }
    resetTurnState();
    const promptResult = await api.acp.prompt(revived.sessionId, "fixture:normal e2e follow-up");
    const completion = await waitFor(() => latestCompletion(revived.sessionId), "resume completed turn");
    if (completion.status !== "completed" || !promptResult || promptResult.ok !== true) {
      throw new Error("Resume follow-up did not complete canonically.");
    }
    const answer = visibleText();
    const recoveredMessages = [...(recovered.messages || [])];
    recoveredMessages.push(userMessage("fixture:normal e2e follow-up"), assistantMessage(answer));
    const requestRecords = new Map((recovered.requestLog || []).map((record) => [record.id, record]));
    for (const record of latestRequestRecords()) requestRecords.set(record.id, record);
    const requestLog = Array.from(requestRecords.values());
    const finalSession = await saveSession({
      ...recovered,
      messages: recoveredMessages,
      engine: "acp",
      agentId: "pi-acp",
      agentSessionId: revived.agentSessionId,
      isProcessing: false,
      requestLog,
      upstreamRequestCount: requestLog.length,
    });
    if (finalSession.isProcessing === true || finalSession.messages.some((message) => message.role === "tool_call" && message.toolError !== true && !message.toolResult)) {
      throw new Error("Resume left processing or an unfinished tool in persisted state.");
    }
    const stop = await api.acp.stop(revived.sessionId);
    if (stop && stop.error) throw new Error(stop.error);
    const remaining = await e2e.runtimeSnapshot();
    if (remaining.some((item) => item.internalId === revived.sessionId)) throw new Error("ACP child remained after resume cleanup.");
    await e2e.writeResult({
      ok: true,
      code: "ok",
      stage: "resume",
      sessionId: revived.sessionId,
      agentSessionId: revived.agentSessionId,
      second: { usedLoad: revived.usedLoad, finalMessageCount: finalSession.messages.length, remainingRuntime: remaining },
    });
    await e2e.shutdown(0);
  };

  const run = async () => {
    await assertPiRuntimeStatus();
    if (config.phase === "resume") {
      await runResume();
    } else if (config.scenario === "stop-active") {
      await runFirstActiveStop();
    } else if (config.scenario === "child-exit") {
      await runFirstChildExit();
    } else if (config.scenario === "timeout") {
      await runFirstTimeout();
    } else if (config.scenario === "crash") {
      await runFirstCrash();
    } else {
      await runFirstSuccess();
    }
  };

  const subscriptions = [
    api.acp.onEvent((event) => { if (event && event._sessionId) state.updates.push(event.update); }),
    api.acp.onTurnComplete((event) => { if (event && event._sessionId) state.completions.push(event); }),
    api.acp.onTurnTransportError((event) => { if (event && event._sessionId) state.transports.push(event); }),
    api.acp.onExit((event) => { if (event && event._sessionId) state.exits.push(event); }),
    api.onUpstreamRequest((event) => { if (event) state.requests.push(event); }),
  ];
  run().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await e2e.writeResult({
        ok: false,
        code: "electron_recovery_restore_failed",
        stage: config.phase,
        message,
        details: {
          updates: state.updates.slice(-8),
          completions: state.completions.slice(-4),
          transports: state.transports.slice(-4),
          exits: state.exits.slice(-4),
        },
      });
      await e2e.shutdown(1);
    } catch {
      document.getElementById("status").textContent = message;
    }
  }).finally(() => { void subscriptions; });
})();
</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
