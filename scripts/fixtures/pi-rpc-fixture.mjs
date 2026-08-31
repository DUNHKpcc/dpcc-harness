#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_PATH = fileURLToPath(import.meta.url);
const FIXTURE_DIR = path.dirname(FIXTURE_PATH);
const SESSION_DIR = path.resolve(
  process.env.PI_CODING_AGENT_SESSION_DIR
    || (process.env.PI_CODING_AGENT_DIR
      ? path.join(process.env.PI_CODING_AGENT_DIR, "sessions")
      : path.join(os.tmpdir(), "pi-coding-agent-sessions")),
);
const DEFAULT_MODEL = {
  provider: "fixture",
  modelId: "fixture-mini",
  name: "Fixture Mini",
  description: "Local RPC fixture model",
};
const DEFAULT_COMMANDS = [
  {
    name: "fixture-info",
    description: "Return the fixture mode and session state.",
    source: "prompt",
    sourceInfo: {
      path: FIXTURE_PATH,
      source: "pi-rpc-fixture",
      scope: "temporary",
      origin: "top-level",
      baseDir: FIXTURE_DIR,
    },
  },
];
const DEFAULT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const MODE_MARKER_RE = /\b(?:pi[-_ ]?fixture|fixture|mode)\s*[:=]\s*(normal|retry-only|retry-then-success|bash-details|hold|exit-nonzero)\b/i;
const PROMPT_RETRY_NOTICE = "Retrying (attempt 1/3, waiting 2s)...";
const PROMPT_RETRY_FINISHED = "Retry finished, resuming.";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

function makeSessionId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL request: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeMode(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "retry-only" || text === "retry_then_success" || text === "retry-then-success") return text.replace(/_/g, "-");
  if (text === "normal" || text === "bash-details") return text;
  if (text === "hold") return "hold";
  if (text === "exit-nonzero") return "exit-nonzero";
  return "";
}

function detectModeFromMessage(message) {
  const envMode = normalizeMode(process.env.PI_RPC_FIXTURE_MODE || process.env.PI_FIXTURE_MODE);
  if (envMode) return envMode;
  const match = String(message ?? "").match(MODE_MARKER_RE);
  if (match) return normalizeMode(match[1]);
  return "normal";
}

function textFromPrompt(message) {
  return String(message ?? "").trim();
}

function cloneMessages(messages) {
  return messages.map((message) => ({ ...message }));
}

async function writeAtomic(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, contents, { mode: 0o600 });
  await fsp.rename(tempPath, filePath);
}

function summarizeAssistantText(messages) {
  return messages
    .filter((message) => message.role === "assistant")
    .map((message) => textFromPrompt(message.content))
    .join("\n")
    .trim();
}

function deriveEntries(messages) {
  return messages.map((message, index) => ({
    entryId: `${message.role}-${index + 1}`,
    text: textFromPrompt(message.content),
  }));
}

function deriveTree(messages) {
  return messages.map((message, index) => ({
    id: `${message.role}-${index + 1}`,
    parentId: index === 0 ? null : `${messages[index - 1].role}-${index}`,
    role: message.role,
    text: textFromPrompt(message.content),
    children: [],
  }));
}

class SessionStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.sessions = new Map();
    ensureDir(rootDir);
  }

  pathFor(sessionId) {
    return path.join(this.rootDir, `${sessionId}.json`);
  }

  async load(sessionId) {
    const filePath = this.pathFor(sessionId);
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.sessionId !== sessionId) {
      throw new Error(`Session identity mismatch: expected ${sessionId}, got ${String(parsed.sessionId ?? "")}`);
    }
    return this.normalize(parsed, sessionId, filePath);
  }

  async loadByPath(sessionPath) {
    const raw = await fsp.readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw);
    const expectedSessionId = path.parse(sessionPath).name;
    if (parsed.sessionId !== expectedSessionId) {
      throw new Error(`Session identity mismatch: expected ${expectedSessionId}, got ${String(parsed.sessionId ?? "")}`);
    }
    return this.normalize(parsed, expectedSessionId, sessionPath);
  }

  normalize(parsed, sessionId, sessionFile) {
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {
      sessionId,
      sessionFile,
      sessionName: parsed.sessionName ?? `Fixture session ${sessionId.slice(0, 8)}`,
      model: parsed.model ?? DEFAULT_MODEL,
      thinkingLevel: parsed.thinkingLevel ?? "medium",
      isStreaming: Boolean(parsed.isStreaming),
      isCompacting: Boolean(parsed.isCompacting),
      steeringMode: parsed.steeringMode ?? "one-at-a-time",
      followUpMode: parsed.followUpMode ?? "one-at-a-time",
      autoCompactionEnabled: Boolean(parsed.autoCompactionEnabled),
      messageCount: messages.length,
      pendingMessageCount: Number(parsed.pendingMessageCount ?? 0),
      messages: cloneMessages(messages),
      updatedAt: parsed.updatedAt ?? nowIso(),
      currentMode: parsed.currentMode ?? "normal",
      currentPromptText: parsed.currentPromptText ?? "",
      currentPromptMode: parsed.currentPromptMode ?? "normal",
      lastAssistantText: parsed.lastAssistantText ?? summarizeAssistantText(messages),
      availableModels: Array.isArray(parsed.availableModels) && parsed.availableModels.length > 0
        ? parsed.availableModels
        : [DEFAULT_MODEL],
      availableCommands: Array.isArray(parsed.availableCommands) && parsed.availableCommands.length > 0
        ? parsed.availableCommands
        : DEFAULT_COMMANDS,
    };
  }

  async save(session) {
    const snapshot = {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionName: session.sessionName,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messageCount,
      pendingMessageCount: session.pendingMessageCount,
      messages: session.messages,
      updatedAt: nowIso(),
      currentMode: session.currentMode,
      currentPromptText: session.currentPromptText,
      currentPromptMode: session.currentPromptMode,
      lastAssistantText: session.lastAssistantText,
      availableModels: session.availableModels,
      availableCommands: session.availableCommands,
    };
    ensureDir(path.dirname(session.sessionFile));
    await writeAtomic(session.sessionFile, `${stableStringify(snapshot)}\n`);
    this.sessions.set(session.sessionId, snapshot);
    return snapshot;
  }
}

const store = new SessionStore(SESSION_DIR);
let activeSession = null;
let currentPromptToken = 0;
let abortRequested = false;

function emitFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function makeResponse(command, id, data = undefined) {
  const response = { id, type: "response", command, success: true };
  if (data !== undefined) response.data = data;
  return response;
}

function makeError(command, id, error) {
  return {
    id,
    type: "response",
    command,
    success: false,
    error,
  };
}

function ensureActiveSession() {
  if (!activeSession) {
    const sessionId = makeSessionId();
    activeSession = {
      sessionId,
      sessionFile: store.pathFor(sessionId),
      sessionName: `Fixture session ${sessionId.slice(0, 8)}`,
      model: DEFAULT_MODEL,
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      autoCompactionEnabled: false,
      messageCount: 0,
      pendingMessageCount: 0,
      messages: [],
      updatedAt: nowIso(),
      currentMode: "normal",
      currentPromptText: "",
      currentPromptMode: "normal",
      lastAssistantText: "",
      availableModels: [DEFAULT_MODEL],
      availableCommands: DEFAULT_COMMANDS,
    };
  }
  return activeSession;
}

function replyResponse(command, id, data = undefined) {
  emitFrame(makeResponse(command, id, data));
}

function replyError(command, id, error) {
  emitFrame(makeError(command, id, error));
}

async function persistSession() {
  if (!activeSession) return;
  await store.save(activeSession);
}

function responseState() {
  const session = ensureActiveSession();
  return {
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    sessionName: session.sessionName,
    autoCompactionEnabled: session.autoCompactionEnabled,
    messageCount: session.messageCount,
    pendingMessageCount: session.pendingMessageCount,
  };
}

function responseCommands() {
  const session = ensureActiveSession();
  return { commands: session.availableCommands };
}

function responseModels() {
  const session = ensureActiveSession();
  return { models: session.availableModels };
}

function appendUserMessage(text) {
  const session = ensureActiveSession();
  session.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
  session.messageCount = session.messages.length;
  session.lastAssistantText = summarizeAssistantText(session.messages);
}

function appendAssistantMessage(text) {
  const session = ensureActiveSession();
  session.messages.push({
    role: "assistant",
    content: text,
    timestamp: Date.now(),
  });
  session.messageCount = session.messages.length;
  session.lastAssistantText = summarizeAssistantText(session.messages);
}

async function emitPromptTurn(message) {
  const session = ensureActiveSession();
  const mode = detectModeFromMessage(message);
  session.currentPromptText = textFromPrompt(message);
  session.currentPromptMode = mode;
  session.currentMode = mode;
  session.isStreaming = true;
  session.pendingMessageCount = 1;
  const turnToken = ++currentPromptToken;
  abortRequested = false;
  await persistSession();

  emitFrame({ type: "agent_start" });
  emitFrame({ type: "turn_start" });
  emitFrame({ type: "message_start", message: { role: "user", content: session.currentPromptText } });
  emitFrame({ type: "message_end", message: { role: "user", content: session.currentPromptText } });
  appendUserMessage(session.currentPromptText);

  emitFrame({
    type: "message_start",
    message: {
      role: "assistant",
      content: "",
    },
  });

  const finishAsSuccess = async (assistantText) => {
    if (turnToken !== currentPromptToken || abortRequested) return;
    if (assistantText) {
      emitFrame({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: assistantText },
      });
      appendAssistantMessage(assistantText);
    }
    emitFrame({
      type: "message_end",
      message: {
        role: "assistant",
        content: assistantText,
      },
    });
    emitFrame({
      type: "turn_end",
      message: {
        role: "assistant",
        content: assistantText,
      },
      toolResults: [],
    });
    emitFrame({
      type: "agent_end",
      messages: cloneMessages(session.messages),
      isTerminal: true,
    });
    emitFrame({ type: "agent_settled" });
    session.isStreaming = false;
    session.pendingMessageCount = 0;
    session.lastAssistantText = summarizeAssistantText(session.messages);
    await persistSession();
  };

  const finishAsRetryOnly = async () => {
    if (turnToken !== currentPromptToken || abortRequested) return;
    emitFrame({
      type: "auto_retry_start",
      attempt: 1,
      maxRetries: 3,
      reason: "upstream_error",
    });
    emitFrame({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: PROMPT_RETRY_NOTICE },
    });
    emitFrame({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: PROMPT_RETRY_FINISHED },
    });
    emitFrame({
      type: "auto_retry_end",
      attempt: 1,
      exhausted: true,
      success: false,
    });
    emitFrame({
      type: "message_end",
      message: {
        role: "assistant",
        content: "",
      },
    });
    emitFrame({
      type: "turn_end",
      message: {
        role: "assistant",
        content: "",
      },
      toolResults: [],
      stopReason: "end_turn",
    });
    emitFrame({
      type: "agent_end",
      messages: cloneMessages(session.messages),
      isTerminal: true,
    });
    emitFrame({ type: "agent_settled" });
    session.isStreaming = false;
    session.pendingMessageCount = 0;
    session.lastAssistantText = summarizeAssistantText(session.messages);
    await persistSession();
  };

  const finishAsRetryThenSuccess = async () => {
    if (turnToken !== currentPromptToken || abortRequested) return;
    emitFrame({
      type: "auto_retry_start",
      attempt: 1,
      maxRetries: 3,
      reason: "upstream_error",
    });
    emitFrame({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: PROMPT_RETRY_NOTICE },
    });
    emitFrame({
      type: "auto_retry_end",
      attempt: 1,
      exhausted: false,
      success: true,
    });
    const finalText = "Recovered after retry and settled cleanly.";
    emitFrame({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: finalText },
    });
    appendAssistantMessage(finalText);
    emitFrame({
      type: "message_end",
      message: {
        role: "assistant",
        content: finalText,
      },
    });
    emitFrame({
      type: "turn_end",
      message: {
        role: "assistant",
        content: finalText,
      },
      toolResults: [],
      stopReason: "end_turn",
    });
    emitFrame({
      type: "agent_end",
      messages: cloneMessages(session.messages),
      isTerminal: true,
    });
    emitFrame({ type: "agent_settled" });
    session.isStreaming = false;
    session.pendingMessageCount = 0;
    session.lastAssistantText = summarizeAssistantText(session.messages);
    await persistSession();
  };

  const finishAsBashDetails = async () => {
    if (turnToken !== currentPromptToken || abortRequested) return;
    const toolCallId = `fixture-bash-${session.sessionId.slice(0, 8)}`;
    const command = "printf 'alpha\\nbeta\\n'";
    emitFrame({
      type: "tool_execution_start",
      toolCallId,
      toolName: "bash",
      args: { command },
    });
    emitFrame({
      type: "tool_execution_update",
      toolCallId,
      partialResult: { content: [{ type: "text", text: "alpha\n" }] },
    });
    emitFrame({
      type: "tool_execution_update",
      toolCallId,
      partialResult: { content: [{ type: "text", text: "alpha\nbeta\n" }] },
    });
    emitFrame({
      type: "tool_execution_end",
      toolCallId,
      result: { content: [{ type: "text", text: "alpha\nbeta\n" }] },
      isError: false,
    });
    await finishAsSuccess("Bash details fixture complete.");
  };

  const finishAsHold = async () => {
    if (turnToken !== currentPromptToken || abortRequested) return;
    const toolCallId = `fixture-hold-${session.sessionId.slice(0, 8)}`;
    const toolCall = {
      type: "tool_execution_start",
      toolCallId,
      toolName: "bash",
      args: { command: "fixture hold" },
    };
    emitFrame(toolCall);
    session.messages.push({
      role: "tool_call",
      id: toolCallId,
      content: "fixture hold",
      toolName: "bash",
      toolInput: toolCall.args,
      isStreaming: true,
      timestamp: Date.now(),
    });
    session.messageCount = session.messages.length;
    // Deliberately leave the turn open. Electron crash recovery needs a real
    // in-flight tool and a persisted streaming session before the process dies.
    await persistSession();
  };

  try {
    if (mode === "exit-nonzero") {
      process.stderr.write("PI_RPC_FIXTURE_FATAL: simulated child exit\n");
      setTimeout(() => process.exit(17), 10);
    } else if (mode === "hold") {
      await finishAsHold();
    } else if (mode === "retry-only") {
      await finishAsRetryOnly();
    } else if (mode === "retry-then-success") {
      await finishAsRetryThenSuccess();
    } else if (mode === "bash-details") {
      await finishAsBashDetails();
    } else {
      await finishAsSuccess("Normal fixture answer.");
    }
  } catch (error) {
    session.isStreaming = false;
    session.pendingMessageCount = 0;
    await persistSession();
    throw error;
  }
}

async function handleRpcCommand(message) {
  if (!message || typeof message !== "object") return;
  const command = String(message.type ?? "");
  const id = message.id ?? null;

  switch (command) {
    case "initialize":
      replyResponse("initialize", id, {
        protocolVersion: Number(message.protocolVersion ?? 1),
      });
      return;
    case "new_session": {
      const sessionId = makeSessionId();
      activeSession = {
        sessionId,
        sessionFile: store.pathFor(sessionId),
        sessionName: `Fixture session ${sessionId.slice(0, 8)}`,
        model: DEFAULT_MODEL,
        thinkingLevel: "medium",
        isStreaming: false,
        isCompacting: false,
        steeringMode: "one-at-a-time",
        followUpMode: "one-at-a-time",
        autoCompactionEnabled: false,
        messageCount: 0,
        pendingMessageCount: 0,
        messages: [],
        updatedAt: nowIso(),
        currentMode: "normal",
        currentPromptText: "",
        currentPromptMode: "normal",
        lastAssistantText: "",
        availableModels: [DEFAULT_MODEL],
        availableCommands: DEFAULT_COMMANDS,
      };
      await persistSession();
      replyResponse("new_session", id, { cancelled: false });
      return;
    }
    case "switch_session": {
      const sessionPath = String(message.sessionPath ?? "");
      if (!sessionPath) {
        replyError(command, id, "sessionPath is required");
        return;
      }
      let loaded;
      try {
        loaded = await store.loadByPath(path.isAbsolute(sessionPath) ? sessionPath : path.resolve(SESSION_DIR, sessionPath));
      } catch (error) {
        replyError(command, id, `Unable to load session: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      activeSession = loaded;
      await persistSession();
      replyResponse("switch_session", id, { cancelled: false });
      return;
    }
    case "session/load": {
      const requestedSessionId = String(message.sessionId ?? "").trim();
      const requestedSessionPath = String(message.sessionPath ?? "").trim();
      if (!requestedSessionId && !requestedSessionPath) {
        replyError(command, id, "sessionPath or sessionId is required");
        return;
      }
      let loaded;
      try {
        loaded = requestedSessionId
          ? await store.load(requestedSessionId)
          : await store.loadByPath(path.isAbsolute(requestedSessionPath)
            ? requestedSessionPath
            : path.resolve(SESSION_DIR, requestedSessionPath));
      } catch (error) {
        replyError(command, id, `Unable to load session: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (requestedSessionId && loaded.sessionId !== requestedSessionId) {
        replyError(command, id, `Loaded session identity mismatch: expected ${requestedSessionId}, got ${loaded.sessionId}`);
        return;
      }
      activeSession = loaded;
      await persistSession();
      replyResponse("session/load", id, {
        cancelled: false,
        sessionId: loaded.sessionId,
        sessionFile: loaded.sessionFile,
      });
      return;
    }
    case "prompt": {
      replyResponse("prompt", id);
      void emitPromptTurn(message.message);
      return;
    }
    case "abort":
      currentPromptToken += 1;
      abortRequested = true;
      replyResponse("abort", id);
      if (activeSession) {
        activeSession.isStreaming = false;
        activeSession.pendingMessageCount = 0;
        emitFrame({
          type: "agent_end",
          messages: cloneMessages(activeSession.messages),
          isTerminal: true,
        });
        emitFrame({ type: "agent_settled" });
        await persistSession();
      }
      return;
    case "steer":
    case "follow_up":
      replyResponse(command, id);
      return;
    case "clear_queue":
      replyResponse("clear_queue", id, { steering: [], followUp: [] });
      return;
    case "set_model":
      ensureActiveSession().model = {
        provider: String(message.provider ?? DEFAULT_MODEL.provider),
        modelId: String(message.modelId ?? DEFAULT_MODEL.modelId),
        name: `${String(message.modelId ?? DEFAULT_MODEL.modelId)} (${String(message.provider ?? DEFAULT_MODEL.provider)})`,
        description: "Fixture-selected model",
      };
      await persistSession();
      replyResponse("set_model", id, ensureActiveSession().model);
      return;
    case "cycle_model":
      replyResponse("cycle_model", id, {
        model: ensureActiveSession().model,
        thinkingLevel: ensureActiveSession().thinkingLevel,
        isScoped: false,
      });
      return;
    case "set_thinking_level":
      ensureActiveSession().thinkingLevel = String(message.level ?? ensureActiveSession().thinkingLevel);
      await persistSession();
      replyResponse("set_thinking_level", id);
      return;
    case "cycle_thinking_level":
      replyResponse("cycle_thinking_level", id, { level: ensureActiveSession().thinkingLevel });
      return;
    case "get_available_thinking_levels":
      replyResponse("get_available_thinking_levels", id, { levels: DEFAULT_THINKING_LEVELS });
      return;
    case "set_steering_mode":
      ensureActiveSession().steeringMode = String(message.mode ?? ensureActiveSession().steeringMode);
      await persistSession();
      replyResponse("set_steering_mode", id);
      return;
    case "set_follow_up_mode":
      ensureActiveSession().followUpMode = String(message.mode ?? ensureActiveSession().followUpMode);
      await persistSession();
      replyResponse("set_follow_up_mode", id);
      return;
    case "set_auto_compaction":
      ensureActiveSession().autoCompactionEnabled = Boolean(message.enabled);
      await persistSession();
      replyResponse("set_auto_compaction", id);
      return;
    case "set_auto_retry":
    case "abort_retry":
    case "abort_bash":
      replyResponse(command, id);
      return;
    case "bash":
      replyResponse("bash", id, { content: [{ type: "text", text: "fixture bash" }] });
      return;
    case "get_state":
      replyResponse("get_state", id, responseState());
      return;
    case "get_available_models":
      replyResponse("get_available_models", id, responseModels());
      return;
    case "get_commands":
      replyResponse("get_commands", id, responseCommands());
      return;
    case "get_messages":
      replyResponse("get_messages", id, { messages: cloneMessages(ensureActiveSession().messages) });
      return;
    case "get_last_assistant_text":
      replyResponse("get_last_assistant_text", id, { text: ensureActiveSession().lastAssistantText || null });
      return;
    case "get_session_stats":
      replyResponse("get_session_stats", id, {
        sessionId: ensureActiveSession().sessionId,
        sessionFile: ensureActiveSession().sessionFile,
        messageCount: ensureActiveSession().messageCount,
        pendingMessageCount: ensureActiveSession().pendingMessageCount,
      });
      return;
    case "get_entries":
      replyResponse("get_entries", id, {
        entries: deriveEntries(ensureActiveSession().messages),
        leafId: ensureActiveSession().messages.length > 0
          ? `${ensureActiveSession().messages[ensureActiveSession().messages.length - 1].role}-${ensureActiveSession().messages.length}`
          : null,
      });
      return;
    case "get_tree":
      replyResponse("get_tree", id, {
        tree: deriveTree(ensureActiveSession().messages),
        leafId: ensureActiveSession().messages.length > 0
          ? `${ensureActiveSession().messages[ensureActiveSession().messages.length - 1].role}-${ensureActiveSession().messages.length}`
          : null,
      });
      return;
    case "set_session_name":
      ensureActiveSession().sessionName = String(message.name ?? ensureActiveSession().sessionName);
      await persistSession();
      replyResponse("set_session_name", id);
      return;
    case "fork":
      replyResponse("fork", id, { text: "", cancelled: false });
      return;
    case "clone":
      replyResponse("clone", id, { cancelled: false });
      return;
    case "export_html":
      replyResponse("export_html", id, { path: path.join(SESSION_DIR, "export.html") });
      return;
    case "session/cancel":
      currentPromptToken += 1;
      abortRequested = true;
      replyResponse("session/cancel", id);
      if (activeSession) {
        activeSession.isStreaming = false;
        activeSession.pendingMessageCount = 0;
        emitFrame({
          type: "agent_end",
          messages: cloneMessages(activeSession.messages),
          isTerminal: true,
        });
        emitFrame({ type: "agent_settled" });
        await persistSession();
      }
      return;
    default:
      replyError(command, id, `Unsupported pi-rpc command: ${command}`);
  }
}

function start() {
  ensureDir(SESSION_DIR);
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = parseJsonLine(line);
        Promise.resolve(handleRpcCommand(message)).catch((error) => {
          emitFrame({
            type: "extension_error",
            extensionPath: FIXTURE_PATH,
            event: "rpc",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      const message = parseJsonLine(buffer.trim());
      Promise.resolve(handleRpcCommand(message)).catch((error) => {
        emitFrame({
          type: "extension_error",
          extensionPath: FIXTURE_PATH,
          event: "rpc",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}

start();
