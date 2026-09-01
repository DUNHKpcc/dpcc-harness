import { BrowserWindow, ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import crypto from "crypto";
import path from "path";
import { log } from "../lib/logger";
import { safeSend } from "../lib/safe-send";
import {
  mergeUtilityRequestUsage,
  startUtilityRequest,
  utilityRequestUsageFromAcp,
  type UtilityRequestUsage,
} from "../lib/upstream-request-tracker";
import {
  capturePiAcpTurnSnapshot,
  readPiAcpTurnUsage,
  type PiAcpTurnSnapshot,
} from "../lib/pi-acp-turn-usage";
import { getAgent } from "../lib/agent-registry";
import { killProcessTree } from "../lib/process-tree";
import type { InstalledAgent } from "../lib/agent-registry";
import { getMcpAuthHeaders } from "../lib/mcp-oauth-flow";
import { extractErrorDetails, extractErrorMessage, reportError } from "../lib/error-utils";
import { reclaimMacDockFocus } from "../lib/macos-dock-focus";
import { normalizeSessionCwd } from "../lib/session-cwd";
import {
  isOfficialPiAcpAgent,
  preparePiAcpLaunch,
} from "../lib/pi-acp-config";
import {
  isLegacyModeConfig,
  reconcileSuccessfulAcpConfigUpdate,
  synthesizeLegacyAcpConfigOptions,
  updateAcpConfigCurrentValue,
  updateAcpModeCurrentValue,
  type LegacyAcpSessionConfiguration,
} from "../lib/acp-config-options";
import { AcpRendererBridge, type AcpRendererChannel } from "../lib/acp-renderer-bridge";
import { AcpSessionOperationCoordinator } from "../lib/acp-session-operations";
import {
  buildAuthRequiredError,
  extractAuthRequired,
  getAuthGuidance,
  normalizeAcpAuthMethods,
} from "../lib/acp-auth";

// ACP SDK is ESM-only, must be async-imported
import type {
  ClientSideConnection,
  ContentBlock,
  McpServer,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
let _acp: typeof import("@agentclientprotocol/sdk") | null = null;
async function getACP() {
  if (!_acp) _acp = await import("@agentclientprotocol/sdk");
  return _acp;
}

import { resolveACPFilePath, applyReadRange, ACP_CLIENT_CAPABILITIES } from "@shared/lib/acp-helpers";
import type { ACPTextFileParams } from "@shared/lib/acp-helpers";
import {
  classifyAcpTurn,
  createAcpTurnObservation,
  isPiStartupBanner,
  isSupportedPiAcpAdapterVersion,
  observeAcpTurnUpdate,
  toAcpPiTurnOutcome,
  type ACPTurnObservation,
} from "@shared/lib/acp-turn";
import { normalizeMcpStdioServer } from "@shared/lib/mcp-config";
import { normalizeCachedAcpConfigOptions } from "@shared/lib/acp-config-cache";
import { normalizeAcpStartCancellationReason } from "@shared/lib/acp-start";
import type { McpServerInput } from "@shared/lib/mcp-config";
import type {
  ACPPiTurnOutcome,
  ACPAuthMethod,
  ACPAuthenticateResult,
  ACPConfigOption,
  ACPErrorDetails,
  ACPStartCancellationReason,
} from "@shared/types/acp";

type ACPReadTextFileParams = ACPTextFileParams & { content?: string; line?: number | null; limit?: number | null };
type ACPWriteTextFileParams = ACPTextFileParams & { content: string };

async function acpReadTextFile(params: ACPReadTextFileParams): Promise<{ content: string; filePath: string }> {
  const filePath = resolveACPFilePath(params);
  const fs = await import("fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return { filePath, content: applyReadRange(content, params.line, params.limit) };
}

async function acpWriteTextFile(params: ACPWriteTextFileParams): Promise<{ filePath: string }> {
  const filePath = resolveACPFilePath(params);
  const fs = await import("fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, params.content, "utf-8");
  return { filePath };
}

const ACP_INIT_TIMEOUT_MS = 15000;
const ACP_START_TIMEOUT_MS = 20000;
const ACP_AUTH_TIMEOUT_MS = 120000;
const DEFAULT_ACP_PROMPT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

export function resolveAcpPromptInactivityTimeoutMs(value = process.env.PCC_AGENT_ACP_PROMPT_INACTIVITY_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 100
    ? Math.floor(parsed)
    : DEFAULT_ACP_PROMPT_INACTIVITY_TIMEOUT_MS;
}

export function withAcpPromptInactivityTimeout<T>(
  operation: Promise<T>,
  getLastActivityAt: () => number,
  timeoutMs = resolveAcpPromptInactivityTimeoutMs(),
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback();
    };
    const check = () => {
      if (settled) return;
      const remaining = timeoutMs - Math.max(0, Date.now() - getLastActivityAt());
      if (remaining <= 0) {
        finish(() => reject(taggedAcpError(
          "acp_prompt_timeout",
          `ACP prompt produced no activity for ${timeoutMs}ms.`,
        )));
        return;
      }
      timer = setTimeout(check, Math.min(remaining, 1_000));
    };

    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    check();
  });
}

interface ACPSessionEntry {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId?: string;
  internalId: string;
  analyticsProperties: AcpAnalyticsProperties;
  eventCounter: number;
  pendingPermissions: Map<string, { resolve: (response: RequestPermissionResponse) => void }>;
  cwd: string;
  supportsLoadSession: boolean;
  agentName: string;
  authMethods: ACPAuthMethod[];
  pendingStartRequest?: {
    cwd: string;
    mcpServers: McpServer[];
    sourceServers: McpServerInput[];
    cachedConfigOptions?: ACPConfigOption[];
    requestedConfigOptions?: ACPConfigOption[];
  };
  /** True while session/load is in-flight — suppresses history replay notifications from reaching the renderer */
  isReloading: boolean;
  /** ACP-side session IDs for ephemeral utility prompts (title gen, commit msg) */
  utilitySessionIds?: Set<string>;
  /** Text accumulator buffers for utility sessions, keyed by ACP sessionId */
  utilityTextBuffers?: Map<string, string>;
  /** Canonical observations for utility sessions, keyed by ACP sessionId. */
  utilityObservations?: Map<string, ACPTurnObservation>;
  /** Last actionable stderr error line observed from the ACP agent process */
  lastStderrError?: string;
  /** Prevents agents such as Pi from receiving concurrent prompts on one connection. */
  operationCoordinator?: AcpSessionOperationCoordinator;
  /** Latest legacy mode event, used to normalize a stale following config event. */
  pendingModeValue?: string;
  /** Startup chunks emitted before this flag are not part of a user turn. */
  hasUserPromptStarted?: boolean;
  /** User prompts currently running or queued on this ACP connection. */
  activeUserPrompts?: number;
  /** True only for the built-in Pi adapter; its retry diagnostics need interpretation. */
  isOfficialPi?: boolean;
  /** Versions captured at launch for compatibility decisions and telemetry. */
  adapterVersion?: string;
  piVersion?: string;
  mcpAdapterVersion?: string;
  /** Terminal turn IDs already emitted to protect against duplicate cleanup paths. */
  terminalTurnIds?: Set<string>;
  /** Bounded, redacted stderr tail retained for the active session. */
  stderrTail?: string;
  /** Observation for the user turn currently being settled. */
  currentTurn?: AcpTurnState;
  /** Includes queued turns, not only the turn currently inside connection.prompt(). */
  turnStates?: Map<string, AcpTurnState>;
}

type AcpTurnFinish = NonNullable<ReturnType<typeof startUtilityRequest>>;

interface AcpTurnState {
  turnId: string;
  startedAt: number;
  lastActivityAt: number;
  observation: ACPTurnObservation;
  stderrError?: string;
  finishRequest?: AcpTurnFinish;
  piUsageSnapshot?: PiAcpTurnSnapshot;
  settled: boolean;
  cancelRequested: boolean;
  outcome?: ACPPiTurnOutcome;
  transportError?: ACPErrorDetails;
  rejectTransport?: (error: ACPErrorDetails) => void;
}

function withAcpTurnTransportSignal<T>(operation: Promise<T>, state: AcpTurnState): Promise<T> {
  const transport = new Promise<never>((_resolve, reject) => {
    state.rejectTransport = (error) => reject(taggedAcpError(error.code, error.message));
  });
  return Promise.race([operation, transport]).finally(() => {
    state.rejectTransport = undefined;
  });
}

function signalAcpTurnTransportFailure(state: AcpTurnState, error: ACPErrorDetails): void {
  state.rejectTransport?.(error);
}

function acpCancellationSignal(): ACPErrorDetails {
  return {
    code: "acp_cancelled",
    message: "ACP turn cancelled.",
    source: "acp",
    stage: "prompt",
    retryable: true,
  };
}

export const acpSessions = new Map<string, ACPSessionEntry>();

/**
 * Small, secret-free runtime view used by the explicit Electron recovery E2E.
 * Keep this separate from the session persistence schema: a child PID is
 * diagnostic process state, not user data.
 */
export function getAcpRecoveryRuntimeSnapshot(): Array<{
  internalId: string;
  agentSessionId?: string;
  pid?: number;
  activeUserPrompts: number;
  currentTurnId?: string;
  isOfficialPi: boolean;
  adapterVersion?: string;
  piVersion?: string;
  mcpAdapterVersion?: string;
}> {
  return [...acpSessions.values()].map((entry) => ({
    internalId: entry.internalId,
    ...(entry.acpSessionId ? { agentSessionId: entry.acpSessionId } : {}),
    ...(entry.process.pid ? { pid: entry.process.pid } : {}),
    activeUserPrompts: entry.activeUserPrompts ?? 0,
    ...(entry.currentTurn?.turnId ? { currentTurnId: entry.currentTurn.turnId } : {}),
    isOfficialPi: entry.isOfficialPi === true,
    ...(entry.adapterVersion ? { adapterVersion: entry.adapterVersion } : {}),
    ...(entry.piVersion ? { piVersion: entry.piVersion } : {}),
    ...(entry.mcpAdapterVersion ? { mcpAdapterVersion: entry.mcpAdapterVersion } : {}),
  }));
}

export function terminateAcpRecoveryRuntime(internalId: string): boolean {
  const entry = acpSessions.get(internalId);
  if (!entry) return false;
  killProcessTree(entry.process, "SIGKILL");
  return true;
}

export function getActiveTurnCount(): number {
  const activeSessions = [...acpSessions.values()].filter(
    (entry) => (entry.activeUserPrompts ?? 0) > 0,
  ).length;
  return activeSessions + (pendingStartProcess && !pendingStartProcess.aborted ? 1 : 0);
}

export function getAcpSessionOperationCoordinator(entry: ACPSessionEntry): AcpSessionOperationCoordinator {
  entry.operationCoordinator ??= new AcpSessionOperationCoordinator();
  return entry.operationCoordinator;
}

export function shouldSuppressAcpSessionUpdate(
  activeAcpSessionId: string | undefined,
  eventAcpSessionId: string,
  eventKind: string,
  hasUserPromptStarted = false,
): boolean {
  if (
    !hasUserPromptStarted
    && (eventKind === "agent_message_chunk" || eventKind === "agent_thought_chunk")
  ) {
    return true;
  }
  return !!activeAcpSessionId && eventAcpSessionId !== activeAcpSessionId;
}

// Buffer latest config options per session — survives the renderer's DRAFT→active transition
// where events arrive before useACP's listener is subscribed
const configBuffer = new Map<string, unknown[]>();

export function getAcpModelFromConfigOptions(
  configOptions: readonly ACPConfigOption[] | undefined,
): string | undefined {
  const value = configOptions
    ?.find((option) => option.id === "model" || option.category === "model")
    ?.currentValue;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getAcpSessionModel(sessionId: string): string | undefined {
  return getAcpModelFromConfigOptions(
    configBuffer.get(sessionId) as ACPConfigOption[] | undefined,
  );
}

// Buffer latest available commands per session — same lifecycle as configBuffer
const commandsBuffer = new Map<string, unknown[]>();

const rendererBridge = new AcpRendererBridge();

function deliverToAcpRenderer(
  getMainWindow: () => BrowserWindow | null,
  sessionId: string,
  channel: AcpRendererChannel,
  payload: unknown,
): void {
  rendererBridge.deliver(sessionId, { channel, payload }, (delivery) => {
    safeSend(getMainWindow, delivery.channel, delivery.payload);
  });
}

function emitAcpTurnOutcome(
  getMainWindow: () => BrowserWindow | null,
  entry: ACPSessionEntry,
  outcome: ReturnType<typeof toAcpPiTurnOutcome>,
  usage: { inputTokens?: number; outputTokens?: number } | null,
): boolean {
  const terminalTurnIds = entry.terminalTurnIds ??= new Set<string>();
  if (terminalTurnIds.has(outcome.turnId)) return false;
  terminalTurnIds.add(outcome.turnId);
  // Keep the set bounded for long-lived sessions.
  if (terminalTurnIds.size > 128) {
    const oldest = terminalTurnIds.values().next().value as string | undefined;
    if (oldest) terminalTurnIds.delete(oldest);
  }

  const payload = {
    _sessionId: entry.internalId,
    turnId: outcome.turnId,
    status: outcome.status,
    ...(outcome.status !== "failed" ? { stopReason: outcome.stopReason } : {}),
    ...(outcome.status === "failed" ? { error: outcome.error } : {}),
    ...(outcome.status === "completed" ? { usage: outcome.usage ?? usage } : {}),
    outcome,
    outcomeDelivered: true as const,
  };
  deliverToAcpRenderer(getMainWindow, entry.internalId, "acp:turn_complete", payload);
  return true;
}

function emitAcpTransportError(
  getMainWindow: () => BrowserWindow | null,
  entry: ACPSessionEntry,
  turnId: string,
  error: ReturnType<typeof buildAcpErrorDetails>,
): boolean {
  const terminalTurnIds = entry.terminalTurnIds ??= new Set<string>();
  if (terminalTurnIds.has(turnId)) return false;
  terminalTurnIds.add(turnId);
  if (terminalTurnIds.size > 128) {
    const oldest = terminalTurnIds.values().next().value as string | undefined;
    if (oldest) terminalTurnIds.delete(oldest);
  }
  deliverToAcpRenderer(getMainWindow, entry.internalId, "acp:turn_transport_error", {
    _sessionId: entry.internalId,
    turnId,
    status: "transport_error" as const,
    error,
    outcomeDelivered: false as const,
  });
  return true;
}

function finishAcpTurnRequest(
  state: AcpTurnState,
  success: boolean,
  usage?: UtilityRequestUsage,
  failure?: { code?: string; message?: string; status?: "failed" | "cancelled" },
): void {
  state.finishRequest?.(success, usage, failure);
}

function toCanonicalAcpUsage(
  usage: UtilityRequestUsage | null | undefined,
): { inputTokens?: number; outputTokens?: number } | null {
  if (
    usage?.inputTokens === undefined
    && usage?.outputTokens === undefined
  ) {
    return null;
  }
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
  };
}

function settleAcpTurnOutcome(
  getMainWindow: () => BrowserWindow | null,
  entry: ACPSessionEntry,
  state: AcpTurnState,
  outcome: ACPPiTurnOutcome,
  usage: UtilityRequestUsage | null,
): boolean {
  if (state.settled) return false;
  state.settled = true;
  state.outcome = outcome;
  emitAcpTurnOutcome(
    getMainWindow,
    entry,
    outcome,
    toCanonicalAcpUsage(usage),
  );
  finishAcpTurnRequest(
    state,
    outcome.status === "completed",
    usage ?? undefined,
    outcome.status === "failed"
      ? { code: outcome.error.code, message: outcome.error.message, status: "failed" }
      : outcome.status === "cancelled"
        ? { code: "acp_cancelled", message: "ACP turn cancelled.", status: "cancelled" }
        : undefined,
  );
  return true;
}

function settleAcpTurnTransportError(
  getMainWindow: () => BrowserWindow | null,
  entry: ACPSessionEntry,
  state: AcpTurnState,
  error: ACPErrorDetails,
): boolean {
  if (state.settled) return false;
  state.settled = true;
  state.transportError = error;
  finishAcpTurnRequest(state, false, undefined, {
    code: error.code,
    message: error.message,
    status: "failed",
  });
  return emitAcpTransportError(getMainWindow, entry, state.turnId, error);
}

function settleAcpTurnCancelled(
  getMainWindow: () => BrowserWindow | null,
  entry: ACPSessionEntry,
  state: AcpTurnState,
): boolean {
  return settleAcpTurnOutcome(
    getMainWindow,
    entry,
    state,
    { status: "cancelled", turnId: state.turnId, stopReason: "cancelled" },
    null,
  );
}

function buildAcpChildExitError(
  entry: ACPSessionEntry,
  options: { code?: number | null; signal?: NodeJS.Signals | null; spawnError?: unknown; stderrError?: unknown } = {},
): ACPErrorDetails {
  const suffix = options.spawnError
    ? extractErrorMessage(options.spawnError)
    : `code=${options.code ?? "null"}, signal=${options.signal ?? "null"}`;
  const stderrMessage = options.stderrError !== undefined
    ? extractErrorMessage(options.stderrError)
    : entry.lastStderrError;
  return buildAcpErrorDetails(
    new Error(
      stderrMessage || `ACP child exited before the active turn settled (${suffix}).`,
    ),
    {
      code: options.spawnError ? "acp_child_error" : "acp_child_exit",
      source: "acp",
      stage: "prompt",
      retryable: true,
    },
  );
}

// Track in-flight acp:start so the renderer can abort during npx download / protocol init.
// Only one start can be in-flight at a time (guarded by materializingRef in the renderer).
let pendingStartProcess: {
  id: string;
  process: ChildProcess;
  aborted?: boolean;
  abortReason?: ACPStartCancellationReason;
} | null = null;

interface AcpCleanupProcess {
  pid?: number;
  kill: (signal?: NodeJS.Signals) => unknown;
}

export function selectAcpStartCleanupProcess(
  connResult: { proc: AcpCleanupProcess } | null | undefined,
  pendingProcess: { process: AcpCleanupProcess } | null | undefined,
): AcpCleanupProcess | undefined {
  return connResult?.proc ?? pendingProcess?.process;
}

export function shouldUseWindowsShellForAcpBinary(binary: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;

  const normalized = binary.trim().replace(/^["']|["']$/g, "");
  const ext = path.extname(normalized).toLowerCase();
  if (ext === ".exe" || ext === ".com") return false;
  if (ext === ".cmd" || ext === ".bat") return true;

  // Bare commands such as "npx" usually resolve to .cmd shims on Windows.
  // Explicit paths should be passed directly unless they opt into a batch shim.
  return !/[\\/]/.test(normalized);
}

export function resolveAcpRuntimeSessionId(
  requestedSessionId?: string,
  generateSessionId: () => string = () => crypto.randomUUID(),
): string {
  const requested = requestedSessionId?.trim();
  return requested || generateSessionId();
}

type AcpAnalyticsProperties = {
  acp_agent: string;
  acp_agent_source: "registry" | "custom";
  acp_agent_launch_method: "bundled" | "npx" | "binary" | "unknown";
  acp_agent_registry_id?: string;
  acp_agent_registry_version?: string;
};

function buildAcpAnalyticsProperties(agent: InstalledAgent): AcpAnalyticsProperties {
  const registryId = agent.registryId?.trim();
  const launchMethod = registryId === "pi-acp"
    ? "bundled"
    : agent.binary === "npx"
      ? "npx"
      : agent.binary
        ? "binary"
        : "unknown";

  if (registryId) {
    return {
      acp_agent: registryId,
      acp_agent_source: "registry",
      acp_agent_launch_method: launchMethod,
      acp_agent_registry_id: registryId,
      ...(agent.registryVersion ? { acp_agent_registry_version: agent.registryVersion } : {}),
    };
  }

  const customHash = crypto.createHash("sha256").update(agent.id).digest("hex").slice(0, 12);
  return {
    acp_agent: `custom:${customHash}`,
    acp_agent_source: "custom",
    acp_agent_launch_method: launchMethod,
  };
}

export function getAcpAnalyticsPropertiesForSession(sessionId: string): Record<string, unknown> | null {
  return acpSessions.get(sessionId)?.analyticsProperties ?? null;
}

/** One-line summary for each ACP session update (mirrors summarizeEvent for Claude) */
export function summarizeUpdate(update: Record<string, unknown>): string {
  const kind = update.sessionUpdate as string;
  switch (kind) {
    case "agent_message_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `agent_message_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "agent_thought_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `agent_thought_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "user_message_chunk": {
      const c = update.content as { type?: string; text?: string } | undefined;
      return `user_message_chunk text_len=${c?.text?.length ?? 0}`;
    }
    case "tool_call": {
      const tc = update as { toolCallId?: string; title?: string; kind?: string; status?: string };
      return `tool_call id=${tc.toolCallId?.slice(0, 12)} title="${tc.title}" kind=${tc.kind ?? "?"} status=${tc.status}`;
    }
    case "tool_call_update": {
      const tcu = update as {
        toolCallId?: string;
        status?: string;
        rawOutput?: unknown;
        content?: unknown[];
        title?: string;
        _meta?: Record<string, unknown> | null;
      };
      const hasOutput = tcu.rawOutput != null;
      const contentCount = Array.isArray(tcu.content) ? tcu.content.length : 0;
      const terminalOutput = tcu._meta?.terminal_output as { data?: unknown } | undefined;
      const terminalExit = tcu._meta?.terminal_exit as { exit_code?: unknown } | undefined;
      const terminalDeltaLength = typeof terminalOutput?.data === "string" ? terminalOutput.data.length : 0;
      const exitCode = typeof terminalExit?.exit_code === "number" ? terminalExit.exit_code : null;
      return `tool_call_update id=${tcu.toolCallId?.slice(0, 12)} status=${tcu.status ?? "?"} title="${tcu.title ?? ""}" hasOutput=${hasOutput} content_items=${contentCount} terminal_delta_len=${terminalDeltaLength} exit_code=${exitCode ?? "?"}`;
    }
    case "plan": {
      const p = update as { entries?: unknown[] };
      return `plan entries=${p.entries?.length ?? 0}`;
    }
    case "usage_update": {
      const uu = update as { size?: number; used?: number; cost?: { amount?: number; currency?: string } };
      const parts: string[] = [];
      if (uu.size != null) parts.push(`size=${uu.size}`);
      if (uu.used != null) parts.push(`used=${uu.used}`);
      if (uu.cost) parts.push(`cost=$${uu.cost.amount}`);
      return `usage_update ${parts.join(" ")}`;
    }
    case "session_info_update": {
      const si = update as { title?: string };
      return `session_info_update title="${si.title ?? ""}"`;
    }
    case "current_mode_update": {
      const cm = update as { currentModeId?: string };
      return `current_mode_update mode=${cm.currentModeId}`;
    }
    case "config_option_update": {
      const co = update as { configOptions?: unknown[] };
      return `config_option_update options_count=${co.configOptions?.length ?? 0}`;
    }
    case "available_commands_update": {
      const ac = update as { availableCommands?: unknown[] };
      return `available_commands_update count=${ac.availableCommands?.length ?? 0}`;
    }
    default:
      return `${kind} (unknown)`;
  }
}

/** Convert renderer MCP server configs to ACP SDK format (with fresh auth headers). */
export async function buildAcpMcpServers(
  servers: McpServerInput[],
  options?: { platform?: string },
): Promise<McpServer[]> {
  const resolved = await Promise.all(servers.map(async (s): Promise<McpServer | null> => {
    const server = normalizeMcpStdioServer(s, { platform: options?.platform });
    if (server.transport === "stdio") {
      if (!server.command) { log("ACP_MCP_WARN", `Server "${server.name}" (stdio) missing command — skipping`); return null; }
      return {
        name: server.name,
        command: server.command,
        args: server.args ?? [],
        env: server.env ? Object.entries(server.env).map(([name, value]) => ({ name, value })) : [],
      };
    }
    if (!server.url) { log("ACP_MCP_WARN", `Server "${server.name}" (${server.transport}) missing URL — skipping`); return null; }
    const authHeaders = await getMcpAuthHeaders(server.name, server.url);
    const mergedHeaders = { ...server.headers, ...authHeaders };
    return {
      type: server.transport,
      name: server.name,
      url: server.url,
      headers: Object.entries(mergedHeaders).map(([name, value]) => ({ name, value })),
    };
  }));
  return resolved.filter((server): server is McpServer => server != null);
}

/** Merge live config sources first, then use the agent cache as a display-safe fallback. */
export function resolveConfigOptions(
  sessionResult: { configOptions?: unknown[] | null } & LegacyAcpSessionConfiguration,
  internalId: string,
  logLabel: string,
  cachedConfigOptions?: unknown,
): unknown[] {
  const fromResponse = (sessionResult.configOptions ?? []) as unknown[];
  const fromEvents = (configBuffer.get(internalId) ?? []) as unknown[];
  const fromCache = normalizeCachedAcpConfigOptions(cachedConfigOptions);
  let configOptions = fromResponse.length ? fromResponse : fromEvents;

  // Fallback: synthesize stable selectors from the legacy unstable models/modes API.
  if (configOptions.length === 0) {
    configOptions = synthesizeLegacyAcpConfigOptions(sessionResult);
    if (configOptions.length > 0) {
      log(logLabel, `No configOptions, synthesized ${configOptions.length} option(s) from unstable models/modes API`);
    }
  }

  if (configOptions.length === 0) {
    configOptions = fromCache;
  }

  if (configOptions.length) configBuffer.set(internalId, configOptions);
  log(logLabel, `${configOptions.length} config options (response=${fromResponse.length}, buffered=${fromEvents.length}, models=${sessionResult.models?.availableModels?.length ?? 0}, modes=${sessionResult.modes?.availableModes?.length ?? 0}, cached=${fromCache.length})`);
  return configOptions;
}

function acpConfigOptionHasValue(option: ACPConfigOption, value: string): boolean {
  return option.options.some((candidate) => (
    "options" in candidate
      ? candidate.options.some((nested) => nested.value === value)
      : candidate.value === value
  ));
}

/**
 * Apply draft/dormant cache selections after session/new or session/load.
 * The runtime catalog stays authoritative: stale values are skipped and the
 * returned live catalog replaces the renderer cache.
 */
export async function reconcileInitialAcpConfigOptions(
  liveConfigOptions: ACPConfigOption[],
  requestedConfigOptions: unknown,
  apply: (configId: string, value: string) => Promise<ACPConfigOption[] | undefined>,
  onError?: (configId: string, value: string, error: unknown) => void,
): Promise<ACPConfigOption[]> {
  const requested = normalizeCachedAcpConfigOptions(requestedConfigOptions)
    .slice()
    .sort((left, right) => Number(right.id === "model") - Number(left.id === "model"));
  let current = liveConfigOptions;

  for (const wanted of requested) {
    const live = current.find((option) => option.id === wanted.id);
    if (!live || !acpConfigOptionHasValue(live, wanted.currentValue)) continue;
    try {
      const updated = await apply(wanted.id, wanted.currentValue);
      if (updated?.length) current = updated;
    } catch (error) {
      onError?.(wanted.id, wanted.currentValue, error);
    }
  }

  return current;
}

async function setAcpSessionConfigValue(
  sessionId: string,
  session: ACPSessionEntry,
  configId: string,
  value: string,
  logLabel: string,
): Promise<ACPConfigOption[] | undefined> {
  if (!session.acpSessionId) {
    throw new Error(buildAuthRequiredError(session.agentName, session.authMethods));
  }
  const acpSessionId = session.acpSessionId;
  const conn = session.connection;

  try {
    const result = await conn.setSessionConfigOption({
      sessionId: acpSessionId,
      configId,
      value,
    });
    log(logLabel, `session=${sessionId.slice(0, 8)} ${configId}=${value} OK (via setSessionConfigOption)`);
    const updated = reconcileSuccessfulAcpConfigUpdate(
      result.configOptions as ACPConfigOption[] | undefined,
      configBuffer.get(sessionId) as ACPConfigOption[] | undefined,
      configId,
      value,
    );
    if (updated) configBuffer.set(sessionId, updated);
    if (isLegacyModeConfig(configId, updated)) session.pendingModeValue = undefined;
    return updated;
  } catch (configError) {
    const buffered = configBuffer.get(sessionId) as ACPConfigOption[] | undefined;

    if (configId === "model") {
      log(logLabel, `session=${sessionId.slice(0, 8)} setSessionConfigOption failed, trying unstable_setSessionModel...`);
      await conn.unstable_setSessionModel({
        sessionId: acpSessionId,
        modelId: value,
      });
      log(logLabel, `session=${sessionId.slice(0, 8)} model=${value} OK (via unstable_setSessionModel)`);
      const updated = updateAcpConfigCurrentValue(buffered, configId, value);
      if (updated) configBuffer.set(sessionId, updated);
      return updated;
    }

    if (isLegacyModeConfig(configId, buffered)) {
      log(logLabel, `session=${sessionId.slice(0, 8)} setSessionConfigOption failed, trying setSessionMode...`);
      await conn.setSessionMode({
        sessionId: acpSessionId,
        modeId: value,
      });
      log(logLabel, `session=${sessionId.slice(0, 8)} ${configId}=${value} OK (via setSessionMode)`);
      const updated = updateAcpConfigCurrentValue(buffered, configId, value);
      if (updated) configBuffer.set(sessionId, updated);
      session.pendingModeValue = undefined;
      return updated;
    }
    throw configError;
  }
}

interface AcpConnectionResult {
  proc: ChildProcess;
  connection: ClientSideConnection;
  pendingPermissions: Map<string, { resolve: (r: RequestPermissionResponse) => void }>;
  internalId: string;
  supportsLoadSession: boolean;
  authMethods: ACPAuthMethod[];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      timer = null;
      reject(new Error(`${stage} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function deriveMcpStatuses(servers: McpServerInput[]): Array<{ name: string; status: "connected" }> {
  return servers.map((server) => ({
    name: server.name,
    status: "connected" as const,
  }));
}

async function finalizePendingAcpSession(
  entry: ACPSessionEntry,
  sessionResult: { sessionId: string; configOptions?: unknown[] | null } & LegacyAcpSessionConfiguration,
  sourceServers: McpServerInput[],
  logLabel: string,
  cachedConfigOptions?: unknown,
  requestedConfigOptions?: unknown,
): Promise<ACPAuthenticateResult> {
  entry.acpSessionId = sessionResult.sessionId;
  entry.pendingStartRequest = undefined;
  const resolvedConfigOptions = resolveConfigOptions(
    sessionResult,
    entry.internalId,
    logLabel,
    cachedConfigOptions,
  ) as ACPConfigOption[];
  const configOptions = await reconcileInitialAcpConfigOptions(
    resolvedConfigOptions,
    requestedConfigOptions,
    (configId, value) => setAcpSessionConfigValue(
      entry.internalId,
      entry,
      configId,
      value,
      `${logLabel}_CONFIG`,
    ),
    (configId, value, error) => {
      reportError(`${logLabel}_CONFIG`, error, {
        engine: "acp",
        sessionId: entry.internalId,
        configId,
        value,
      });
    },
  );
  return {
    ok: true,
    sessionId: entry.internalId,
    agentSessionId: sessionResult.sessionId,
    agentName: entry.agentName,
    configOptions: configOptions as ACPAuthenticateResult["configOptions"],
    mcpStatuses: deriveMcpStatuses(sourceServers),
  };
}

/**
 * Spawn an ACP agent process, create the ClientSideConnection, and initialize the protocol.
 * Shared by acp:start and acp:revive-session to avoid duplicating ~120 lines of boilerplate.
 */
interface AcpLaunchDefinition {
  binary: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  name: string;
  replaceEnvironment?: boolean;
  isOfficialPi?: boolean;
  adapterVersion?: string;
  piVersion?: string;
  mcpAdapterVersion?: string;
  cleanup?: () => void;
}

const MAX_ACP_STDERR_TAIL = 4_000;
const MAX_ACP_ERROR_MESSAGE = 2_000;

function clipAcpText(value: string, max = MAX_ACP_ERROR_MESSAGE): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function sanitizeAcpStderr(value: string): string {
  return clipAcpText(value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"]+/gi, "$1[REDACTED]")
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@"));
}

function appendStderrTail(previous: string | undefined, next: string): string {
  const combined = previous ? `${previous}\n${next}` : next;
  return combined.length > MAX_ACP_STDERR_TAIL
    ? combined.slice(-MAX_ACP_STDERR_TAIL)
    : combined;
}

function buildAcpErrorDetails(
  err: unknown,
  options: {
    code?: string;
    source?: "harnss" | "acp" | "pi" | "upstream";
    stage?: "spawn" | "initialize" | "authenticate" | "prompt" | "settle" | "persist";
    retryable?: boolean;
    fallbackMessage?: string;
  } = {},
) {
  const extracted = extractErrorDetails(err);
  const message = clipAcpText(extracted.message || options.fallbackMessage || "ACP operation failed.");
  return {
    code: options.code ?? (typeof extracted.code === "string" ? extracted.code : "acp_transport_error"),
    message,
    source: options.source ?? "acp",
    stage: options.stage ?? "prompt",
    retryable: options.retryable ?? true,
    ...(extracted.cause ? { cause: clipAcpText(extracted.cause, 1_000) } : {}),
  } as const;
}

function taggedAcpError(code: string, message: string, cause?: unknown): Error & { code: string; cause?: unknown } {
  const error = new Error(message) as Error & { code: string; cause?: unknown };
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

export function buildAcpPromptTransportErrorDetails(
  err: unknown,
  options: { isOfficialPi: boolean; stderrMessage?: string },
): ACPErrorDetails {
  const extracted = extractErrorDetails(err);
  const message = options.stderrMessage || extracted.message;
  const upstreamEvidence = /(?:\b401\b|\b403\b|\b429\b|unauthorized|rate.?limit|provider|api\s+error|connection\s+(?:failed|reset|refused))/i.test(message);
  const piChildExit = options.isOfficialPi && /pi process exited\s*\(code=/i.test(extracted.message);
  const protocolError = /(?:invalid\s+(?:json|protocol)|json-rpc|unsupported\s+protocol)/i.test(extracted.message);
  const extractedStableCode = typeof extracted.code === "string"
    && /^(?:acp|pi|harnss|upstream)_/.test(extracted.code)
    ? extracted.code
    : undefined;
  const code = extractedStableCode
    ? extractedStableCode
    : piChildExit
      ? "pi_child_exit"
      : options.stderrMessage
        ? upstreamEvidence ? "pi_upstream_error" : "pi_runtime_error"
        : protocolError
          ? "acp_protocol_error"
          : "acp_prompt_transport_error";
  const source: ACPErrorDetails["source"] = code.includes("upstream") || upstreamEvidence
    ? "upstream"
    : code.startsWith("pi_")
      ? "pi"
      : "acp";
  return buildAcpErrorDetails(
    options.stderrMessage ? new Error(options.stderrMessage) : err,
    {
      code,
      source,
      stage: "prompt",
      retryable: code !== "acp_protocol_error",
    },
  );
}

export function buildAcpLifecycleErrorDetails(
  err: unknown,
  fallbackCode: string,
  fallbackStage: ACPErrorDetails["stage"],
): ACPErrorDetails {
  const extracted = extractErrorDetails(err);
  const code = typeof extracted.code === "string" ? extracted.code : fallbackCode;
  const configurationFailure = code === "pi_runtime_host_missing"
    || code === "pi_bundled_wrapper_missing"
    || code === "pi_bundled_package_missing"
    || code === "pi_acp_bundled_package_missing"
    || code === "pi_mcp_bundled_package_missing"
    || code === "pi_mcp_bridge_missing"
    || code === "pi_bundled_version_mismatch"
    || code === "pi_acp_bundled_version_mismatch"
    || code === "pi_mcp_bundled_version_mismatch"
    || code === "pi_mcp_config_invalid"
    || code === "pi_e2e_command_invalid"
    || code === "pi_config_incomplete"
    || code === "pi_catalog_unavailable"
    || code === "pi_catalog_missing"
    || code === "pi_model_unavailable"
    || code === "pi_provider_unsupported";
  const stage = configurationFailure || code === "acp_child_error"
    ? "spawn"
    : fallbackStage;
  return buildAcpErrorDetails(err, {
    code,
    source: code.startsWith("pi_") ? "pi" : "acp",
    stage,
    retryable: !configurationFailure,
  });
}

export function supportsInProcessMcpReload(
  session: Pick<ACPSessionEntry, "supportsLoadSession" | "isOfficialPi">,
): boolean {
  return session.supportsLoadSession && session.isOfficialPi !== true;
}

async function createAcpConnection(
  agentDef: AcpLaunchDefinition,
  getMainWindow: () => BrowserWindow | null,
  logLabel: string,
  onSpawn?: (internalId: string, proc: ChildProcess) => void,
  requestedInternalId?: string,
): Promise<AcpConnectionResult> {
  const acp = await getACP();
  const internalId = resolveAcpRuntimeSessionId(requestedInternalId);
  rendererBridge.open(internalId);

  const proc = spawn(agentDef.binary, agentDef.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: agentDef.replaceEnvironment ? agentDef.env : { ...process.env, ...agentDef.env },
    shell: shouldUseWindowsShellForAcpBinary(agentDef.binary),
    windowsHide: true,
  });
  let launchArtifactsCleaned = false;
  const cleanupLaunchArtifacts = () => {
    if (launchArtifactsCleaned) return;
    launchArtifactsCleaned = true;
    agentDef.cleanup?.();
  };
  proc.once("exit", cleanupLaunchArtifacts);
  proc.once("error", cleanupLaunchArtifacts);
  log(
    logLabel,
    `Launched ${agentDef.name} host=${path.basename(agentDef.binary)} pid=${proc.pid ?? "pending"}`
      + ` piAcp=${agentDef.adapterVersion ?? "custom"}`
      + ` pi=${agentDef.piVersion ?? "n/a"}`
      + ` piMcp=${agentDef.mcpAdapterVersion ?? "n/a"}`,
  );
  reclaimMacDockFocus(getMainWindow, "acp-start");
  onSpawn?.(internalId, proc);
  let startupProcessError: unknown;
  let startupStderrTail: string | undefined;
  let startupStderrError: string | undefined;

  const settleActiveTurns = (
    entry: ACPSessionEntry,
    error: ACPErrorDetails | ((state: AcpTurnState) => ACPErrorDetails),
  ): string | undefined => {
    let firstTurnId: string | undefined;
    for (const state of entry.turnStates?.values() ?? []) {
      if (state.settled) continue;
      firstTurnId ??= state.turnId;
      if (state.cancelRequested) {
        settleAcpTurnCancelled(getMainWindow, entry, state);
        signalAcpTurnTransportFailure(state, acpCancellationSignal());
      } else {
        const details = typeof error === "function" ? error(state) : error;
        settleAcpTurnTransportError(
          getMainWindow,
          entry,
          state,
          details,
        );
        signalAcpTurnTransportFailure(state, details);
      }
    }
    return firstTurnId;
  };

  // Process lifecycle handlers
  proc.on("error", (err) => {
    startupProcessError = err;
    log(logLabel, `ERROR: spawn failed: ${err.message}`);
    const entry = acpSessions.get(internalId);
    const error = entry
      ? buildAcpChildExitError(entry, { spawnError: err })
      : buildAcpErrorDetails(err, {
        code: "acp_child_error",
        source: "acp",
        stage: "spawn",
        retryable: false,
      });
    const turnId = entry ? settleActiveTurns(entry, error) : undefined;
    safeSend(getMainWindow, "acp:exit", {
      _sessionId: internalId,
      code: 1,
      ...(turnId ? { turnId } : {}),
      error: error.message,
      errorCode: error.code,
    });
    entry?.operationCoordinator?.close(`ACP process failed to start: ${err.message}`);
    acpSessions.delete(internalId);
    configBuffer.delete(internalId);
    commandsBuffer.delete(internalId);
    rendererBridge.close(internalId, error.message);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString().trim();
    if (!raw) return;
    const cleaned = sanitizeAcpStderr(raw);
    startupStderrTail = appendStderrTail(startupStderrTail, cleaned);
    log("ACP_STDERR", {
      session: internalId.slice(0, 8),
      tail: cleaned,
    });
    const turnError = cleaned.match(/Unhandled error during turn:\s*(.+)$/)?.[1]?.trim();
    const parsed = turnError || (/(?:\bERROR\b|\berror\b|\bfailed\b|\btimeout\b|\bunauthorized\b|\bconnection\b)/i.test(cleaned)
      ? cleaned
      : undefined);
    if (!parsed) return;
    startupStderrError = parsed;
    const entry = acpSessions.get(internalId);
    if (entry) {
      entry.stderrTail = appendStderrTail(entry.stderrTail, cleaned);
      entry.lastStderrError = parsed;
      if (entry.currentTurn) {
        entry.currentTurn.stderrError = parsed;
        entry.currentTurn.lastActivityAt = Date.now();
      }
    }
  });

  proc.on("exit", (code, signal) => {
    // Guard: session may already be deleted by the "error" handler (ENOENT race)
    if (!acpSessions.has(internalId)) return;
    const entry = acpSessions.get(internalId)!;
    log("ACP_EXIT", `session=${internalId.slice(0, 8)} code=${code} signal=${signal ?? "null"} total_events=${entry.eventCounter}`);
    const activeTurn = [...(entry.turnStates?.values() ?? [])].find((state) => !state.settled);
    const turnId = activeTurn
      ? settleActiveTurns(entry, (state) => buildAcpChildExitError(entry, {
        code,
        signal,
        stderrError: state.stderrError,
      }))
      : undefined;
    const exitError = activeTurn ? buildAcpChildExitError(entry, {
      code,
      signal,
      stderrError: activeTurn.stderrError,
    }) : undefined;
    for (const [, resolver] of entry.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    entry.pendingPermissions.clear();
    safeSend(getMainWindow, "acp:exit", {
      _sessionId: internalId,
      code,
      ...(turnId ? { turnId } : {}),
      ...(exitError ? { error: exitError.message, errorCode: exitError.code } : {}),
    });
    acpSessions.delete(internalId);
    configBuffer.delete(internalId);
    commandsBuffer.delete(internalId);
    entry.operationCoordinator?.close("ACP process exited.");
    rendererBridge.close(internalId, "ACP process exited.");
  });

  // Stream + connection setup
  const input = Writable.toWeb(proc.stdin!) as WritableStream;
  const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  const pendingPermissions = new Map<string, { resolve: (r: RequestPermissionResponse) => void }>();

  const connection = new acp.ClientSideConnection((_agent) => ({
    async sessionUpdate(params: Record<string, unknown>) {
      const update = (params as { update: Record<string, unknown> }).update;
      let forwardedUpdate = update;
      const acpSessionId = (params as { sessionId: string }).sessionId;
      const entry = acpSessions.get(internalId);

      // Utility session events: accumulate text, skip renderer forwarding
      if (entry?.utilitySessionIds?.has(acpSessionId)) {
        const observation = entry.utilityObservations?.get(acpSessionId);
        const observed = observation
          ? observeAcpTurnUpdate(observation, update, {
            isPi: entry.isOfficialPi,
            adapterVersion: entry.adapterVersion,
          })
          : { diagnostic: false };
        const eventKind = (update as { sessionUpdate: string }).sessionUpdate;
        if (eventKind === "agent_message_chunk" && !observed.diagnostic) {
          const text = (update as { content?: { text?: string } }).content?.text ?? "";
          if (text && entry.utilityTextBuffers) {
            const current = entry.utilityTextBuffers.get(acpSessionId) ?? "";
            entry.utilityTextBuffers.set(acpSessionId, current + text);
          }
        }
        return;
      }

      if (entry) entry.eventCounter++;
      const count = entry?.eventCounter ?? 0;
      const summary = summarizeUpdate(update);
      log("ACP_EVENT", `session=${internalId.slice(0, 8)} #${count} ${entry?.isReloading ? "[suppressed] " : ""}${summary}`);

      // Full dump for tool calls and tool results
      const eventKind = update?.sessionUpdate as string;
      if (eventKind === "tool_call" || eventKind === "tool_call_update") {
        log("ACP_EVENT_FULL", update);
      }

      const messageText = eventKind === "agent_message_chunk"
        ? (update as { content?: { text?: unknown } }).content?.text
        : undefined;
      if (
        entry?.isOfficialPi === true
        && isSupportedPiAcpAdapterVersion(entry.adapterVersion)
        && typeof messageText === "string"
        && isPiStartupBanner(messageText)
      ) {
        log("ACP_PI_STARTUP", {
          session: internalId.slice(0, 8),
          adapterVersion: entry.adapterVersion,
          piVersion: entry.piVersion,
          mcpAdapterVersion: entry.mcpAdapterVersion,
        });
        return;
      }

      // Pi emits automatic retry status as agent text. It is transport
      // diagnostics, not an assistant answer, so observe it for outcome
      // classification and keep it out of persisted chat content.
      if (entry?.currentTurn && entry.acpSessionId === acpSessionId) {
        entry.currentTurn.lastActivityAt = Date.now();
        const observed = observeAcpTurnUpdate(entry.currentTurn.observation, update, {
          isPi: entry.isOfficialPi,
          adapterVersion: entry.adapterVersion,
        });
        if (observed.diagnostic) {
          log("ACP_PI_RETRY", {
            session: internalId.slice(0, 8),
            turnId: entry.currentTurn.turnId,
            adapterVersion: entry.adapterVersion,
            piVersion: entry.piVersion,
            mcpAdapterVersion: entry.mcpAdapterVersion,
            retryNoticeCount: entry.currentTurn.observation.retryNoticeCount,
          });
          return;
        }
      }

      // session/new may emit unsolicited welcome text before the ACP-side
      // session ID is known. It is transport metadata, not a user turn.
      if (shouldSuppressAcpSessionUpdate(
        entry?.acpSessionId,
        acpSessionId,
        eventKind,
        entry?.hasUserPromptStarted,
      )) {
        if (entry?.acpSessionId && acpSessionId !== entry.acpSessionId) {
          log("ACP_EVENT", `session=${internalId.slice(0, 8)} suppressing update from untracked ACP session=${acpSessionId.slice(0, 12)}`);
          return;
        }
        log("ACP_EVENT", `session=${internalId.slice(0, 8)} suppressing pre-session ${eventKind}`);
        return;
      }

      // Buffer config options for late-subscribing renderer listeners
      if (eventKind === "config_option_update") {
        const rawConfigOptions = (update as { configOptions: ACPConfigOption[] }).configOptions;
        const configOptions = entry?.pendingModeValue
          ? (updateAcpModeCurrentValue(rawConfigOptions, entry.pendingModeValue) ?? rawConfigOptions)
          : rawConfigOptions;
        configBuffer.set(internalId, configOptions);
        forwardedUpdate = { ...update, configOptions };
      }

      if (eventKind === "current_mode_update") {
        const currentModeId = (update as { currentModeId: string }).currentModeId;
        if (entry) entry.pendingModeValue = currentModeId;
        const updated = updateAcpModeCurrentValue(
          configBuffer.get(internalId) as ACPConfigOption[] | undefined,
          currentModeId,
        );
        if (updated) configBuffer.set(internalId, updated);
      }

      // Buffer available commands for late-subscribing renderer listeners
      if (eventKind === "available_commands_update") {
        const commands = (update as { availableCommands: unknown[] }).availableCommands;
        commandsBuffer.set(internalId, commands);
      }

      // During session/load, suppress history replay from reaching the renderer
      if (entry?.isReloading) return;

      deliverToAcpRenderer(getMainWindow, internalId, "acp:event", {
        _sessionId: internalId,
        sessionId: acpSessionId,
        update: forwardedUpdate,
      });
    },

    async requestPermission(params: Record<string, unknown>) {
      const acpSessionId = (params as { sessionId: string }).sessionId;
      const entry = acpSessions.get(internalId);

      // Auto-deny permission requests for utility sessions
      if (entry?.utilitySessionIds?.has(acpSessionId)) {
        log("ACP_UTILITY", `Auto-denying permission for utility session ${acpSessionId.slice(0, 12)}`);
        const options = (params as { options: Array<{ optionId: string; kind: string }> }).options;
        const rejectOption = options.find(o => o.kind === "reject_once") ?? options[options.length - 1];
        return { outcome: { outcome: "selected", optionId: rejectOption?.optionId ?? "reject" } };
      }

      return new Promise<RequestPermissionResponse>((resolve) => {
        const requestId = crypto.randomUUID();
        const toolCall = (params as { toolCall: Record<string, unknown> }).toolCall;
        const opts = (params as { options: unknown[] }).options;
        pendingPermissions.set(requestId, { resolve });

        log("ACP_PERMISSION_REQUEST", {
          session: internalId.slice(0, 8),
          requestId,
          tool: toolCall?.title,
          kind: toolCall?.kind,
          toolCallId: (toolCall?.toolCallId as string)?.slice(0, 12),
          optionCount: Array.isArray(opts) ? opts.length : 0,
        });

        safeSend(getMainWindow, "acp:permission_request", {
          _sessionId: internalId,
          requestId,
          sessionId: acpSessionId,
          toolCall,
          options: opts,
        });
      });
    },

    async readTextFile(params: { path?: string; uri?: string; line?: number | null; limit?: number | null }) {
      const { filePath, content } = await acpReadTextFile(params);
      log("ACP_FS", `readTextFile path=${filePath} line=${params.line ?? ""} limit=${params.limit ?? ""}`);
      log("ACP_FS", `readTextFile result len=${content.length}`);
      return { content };
    },
    async writeTextFile(params: { path?: string; uri?: string; content: string }) {
      const { filePath } = await acpWriteTextFile(params);
      log("ACP_FS", `writeTextFile path=${filePath} len=${params.content.length}`);
      return {};
    },
  }), stream);

  // Protocol initialization
  log(logLabel, `Initializing protocol...`);
  let initResult: Awaited<ReturnType<ClientSideConnection["initialize"]>>;
  try {
    initResult = await withTimeout(connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: ACP_CLIENT_CAPABILITIES,
    }), ACP_INIT_TIMEOUT_MS, `${agentDef.name} ACP initialize`);
  } catch (err) {
    if (startupProcessError) {
      throw taggedAcpError(
        "acp_child_error",
        extractErrorMessage(startupProcessError),
        err,
      );
    }
    if (startupStderrError) {
      throw taggedAcpError(
        "acp_initialize_stderr",
        startupStderrError,
        startupStderrTail && startupStderrTail !== startupStderrError
          ? startupStderrTail
          : err,
      );
    }
    throw taggedAcpError("acp_initialize_failed", extractErrorMessage(err), err);
  }
  const supportsLoadSession = initResult.agentCapabilities?.loadSession === true;
  const authMethods = normalizeAcpAuthMethods((initResult as Record<string, unknown>).authMethods);
  log(logLabel, `Initialized protocol v${initResult.protocolVersion} for ${agentDef.name} (loadSession=${supportsLoadSession}, authMethods=${authMethods.length})`);

  return { proc, connection, pendingPermissions, internalId, supportsLoadSession, authMethods };
}

async function resolveAcpLaunchDefinition(
  agent: InstalledAgent,
  options?: { cwd: string; mcpServers: McpServer[] },
): Promise<AcpLaunchDefinition> {
  if (isOfficialPiAcpAgent(agent)) {
    return {
      ...(await preparePiAcpLaunch(agent, options)),
      isOfficialPi: true,
    };
  }
  return {
    binary: agent.binary?.trim() ?? "",
    args: agent.args,
    env: agent.env,
    name: agent.name,
    isOfficialPi: false,
  };
}

export function register(getMainWindow: () => BrowserWindow | null): void {

  // Forward renderer-side ACP logs to main process log file
  ipcMain.on("acp:log", (_event, label: string, data: unknown) => {
    log(`ACP_UI:${label}`, data);
  });

  ipcMain.handle("acp:start", async (_event, options: {
    agentId: string;
    cwd: string;
    mcpServers?: McpServerInput[];
    initialConfigOptions?: ACPConfigOption[];
  }) => {
    const cwd = normalizeSessionCwd(options.cwd);
    log("ACP_SPAWN", `acp:start called with agentId=${options.agentId} cwd=${cwd}`);

    const agentDef = getAgent(options.agentId);
    if (!agentDef || agentDef.engine !== "acp") {
      const err = `Agent "${options.agentId}" not found or not an ACP agent`;
      log("ACP_SPAWN", `ERROR: ${err}`);
      const errorDetails = buildAcpErrorDetails(new Error(err), {
        code: "acp_agent_not_found",
        source: "harnss",
        stage: "spawn",
        retryable: false,
      });
      return { error: errorDetails.message, errorDetails };
    }
    if (!agentDef.binary) {
      const err = `Agent "${options.agentId}" has no binary configured`;
      log("ACP_SPAWN", `ERROR: ${err}`);
      const errorDetails = buildAcpErrorDetails(new Error(err), {
        code: "acp_binary_missing",
        source: "harnss",
        stage: "spawn",
        retryable: false,
      });
      return { error: errorDetails.message, errorDetails };
    }

    let connResult: AcpConnectionResult | null = null;
    let launchDef: AcpLaunchDefinition | undefined;
    const analyticsProperties = buildAcpAnalyticsProperties(agentDef);
    try {
      const acpMcpServers = await buildAcpMcpServers(options.mcpServers ?? []);
      launchDef = await resolveAcpLaunchDefinition(agentDef, { cwd, mcpServers: acpMcpServers });
      connResult = await createAcpConnection(
        launchDef,
        getMainWindow,
        "ACP_SPAWN",
        (internalId, proc) => {
          pendingStartProcess = { id: internalId, process: proc };
        },
      );
      const { proc, connection, pendingPermissions, internalId, supportsLoadSession, authMethods } = connResult;

      const entry: ACPSessionEntry = {
        process: proc,
        connection,
        internalId,
        analyticsProperties,
        eventCounter: 0,
        pendingPermissions,
        cwd,
        supportsLoadSession,
        agentName: agentDef.name,
        authMethods,
        pendingStartRequest: {
          cwd,
          mcpServers: acpMcpServers,
          sourceServers: options.mcpServers ?? [],
          cachedConfigOptions: normalizeCachedAcpConfigOptions(agentDef.cachedConfigOptions),
          requestedConfigOptions: normalizeCachedAcpConfigOptions(options.initialConfigOptions),
        },
        isReloading: false,
        isOfficialPi: launchDef.isOfficialPi === true,
        adapterVersion: launchDef.adapterVersion,
        piVersion: launchDef.piVersion,
        mcpAdapterVersion: launchDef.mcpAdapterVersion,
        terminalTurnIds: new Set(),
        turnStates: new Map(),
      };
      acpSessions.set(internalId, entry);

      log("ACP_SPAWN", `Creating new session with ${acpMcpServers.length} MCP server(s)...`);
      const sessionResult = await withTimeout(connection.newSession({
        cwd,
        mcpServers: acpMcpServers,
      }), ACP_START_TIMEOUT_MS, `${agentDef.name} ACP session/new`);
      log("ACP_SPAWN", `Created session ${sessionResult.sessionId} for ${agentDef.name}`);

      // Startup succeeded — clear the pending tracker before returning
      pendingStartProcess = null;

      return await finalizePendingAcpSession(
        entry,
        sessionResult,
        options.mcpServers ?? [],
        "ACP_SPAWN",
        agentDef.cachedConfigOptions,
        options.initialConfigOptions,
      );
    } catch (err) {
      const authMethods = connResult?.authMethods ?? [];
      const authRequiredMethods = extractAuthRequired(err, authMethods);
      if (authRequiredMethods && connResult) {
        pendingStartProcess = null;
        const entry = acpSessions.get(connResult.internalId);
        if (entry) {
          entry.authMethods = authRequiredMethods;
        }
        return {
          authRequired: true as const,
          sessionId: connResult.internalId,
          agentName: agentDef.name,
          authMethods: authRequiredMethods,
        };
      }

      // Check if the user intentionally aborted the start (stop button during download)
      const abortedStart = pendingStartProcess;
      const wasAborted = abortedStart?.aborted === true;
      const cancelReason = wasAborted
        ? normalizeAcpStartCancellationReason(abortedStart?.abortReason)
        : undefined;
      const cleanupProcess = selectAcpStartCleanupProcess(connResult, abortedStart);
      pendingStartProcess = null;

      // Kill the spawned process to avoid orphans
      killProcessTree(cleanupProcess);
      if (connResult?.internalId) {
        acpSessions.get(connResult.internalId)?.operationCoordinator?.close("ACP session start failed.");
        acpSessions.delete(connResult.internalId);
        configBuffer.delete(connResult.internalId);
        commandsBuffer.delete(connResult.internalId);
        rendererBridge.close(connResult.internalId, "ACP session start failed.");
      }

      if (wasAborted) {
        log("ACP_SPAWN", `Start cancelled reason=${cancelReason}`);
        return { cancelled: true, cancelReason };
      }

      const errorDetails = buildAcpLifecycleErrorDetails(err, "acp_start_failed", "initialize");
      reportError("ACP_SPAWN", err, {
        engine: "acp",
        ...analyticsProperties,
        stage: errorDetails.stage,
        errorCode: errorDetails.code,
        surfacedError: errorDetails.message,
        adapterVersion: launchDef?.adapterVersion,
        piVersion: launchDef?.piVersion,
        mcpAdapterVersion: launchDef?.mcpAdapterVersion,
        mcpServerCount: options.mcpServers?.length ?? 0,
      });
      return { error: errorDetails.message, errorDetails };
    }
  });

  ipcMain.handle("acp:authenticate", async (_event, { sessionId, methodId }: { sessionId: string; methodId: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      const errorDetails = buildAcpErrorDetails(new Error("ACP session not found."), {
        code: "acp_session_not_found",
        source: "harnss",
        stage: "authenticate",
        retryable: false,
      });
      return { error: errorDetails.message, errorDetails };
    }
    if (!session.pendingStartRequest) {
      const errorDetails = buildAcpErrorDetails(new Error("ACP session does not need authentication."), {
        code: "acp_auth_not_required",
        source: "harnss",
        stage: "authenticate",
        retryable: false,
      });
      return { error: errorDetails.message, errorDetails };
    }

    try {
      await withTimeout(
        session.connection.authenticate({ methodId }),
        ACP_AUTH_TIMEOUT_MS,
        `${session.agentName} ACP authenticate(${methodId})`,
      );

      const pendingStartRequest = session.pendingStartRequest;
      const sessionResult = await withTimeout(session.connection.newSession({
        cwd: pendingStartRequest.cwd,
        mcpServers: pendingStartRequest.mcpServers,
      }), ACP_START_TIMEOUT_MS, `${session.agentName} ACP session/new after authenticate`);

      const finalized = await finalizePendingAcpSession(
        session,
        sessionResult,
        pendingStartRequest.sourceServers,
        "ACP_AUTH",
        pendingStartRequest.cachedConfigOptions,
        pendingStartRequest.requestedConfigOptions,
      );

      return finalized;
    } catch (err) {
      const authRequiredMethods = extractAuthRequired(err, session.authMethods);
      if (authRequiredMethods) {
        session.authMethods = authRequiredMethods;
        return {
          authRequired: true,
          sessionId,
          agentName: session.agentName,
          authMethods: authRequiredMethods,
          error: buildAuthRequiredError(session.agentName, authRequiredMethods),
        };
      }

      const message = extractErrorMessage(err);
      const guidance = getAuthGuidance(session.agentName, session.authMethods);
      const error = guidance ? `${message} ${guidance}` : message;
      const errorDetails = buildAcpErrorDetails(new Error(error), {
        code: "acp_auth_failed",
        source: "acp",
        stage: "authenticate",
        retryable: true,
      });
      log("ACP_AUTH", {
        session: sessionId.slice(0, 8),
        stage: errorDetails.stage,
        errorCode: errorDetails.code,
        error: errorDetails.message,
      });
      return { error: errorDetails.message, errorDetails };
    }
  });

  // Revive a dead ACP session after app restart.
  // Spawns a fresh agent process and calls session/load (if supported) to restore context,
  // or falls back to newSession (fresh context, UI messages already restored from disk).
  ipcMain.handle("acp:revive-session", async (_event, options: {
    agentId: string;
    cwd: string;
    sessionId?: string; // Stable dpcc-side session ID from the persisted sidebar entry
    agentSessionId?: string; // ACP-side session ID from previous run
    mcpServers?: McpServerInput[];
    initialConfigOptions?: ACPConfigOption[];
  }) => {
    const cwd = normalizeSessionCwd(options.cwd);
    log("ACP_REVIVE", `agentId=${options.agentId} agentSessionId=${options.agentSessionId?.slice(0, 12) ?? "none"} cwd=${cwd}`);

    const agentDef = getAgent(options.agentId);
    if (!agentDef || agentDef.engine !== "acp" || !agentDef.binary) {
      const errorDetails = buildAcpErrorDetails(
        new Error(`Agent "${options.agentId}" not found or not an ACP agent`),
        {
          code: "acp_agent_not_found",
          source: "harnss",
          stage: "spawn",
          retryable: false,
        },
      );
      return { error: errorDetails.message, errorDetails };
    }

    const reconcileRequestedConfig = (
      sessionId: string,
      entry: ACPSessionEntry,
      liveConfigOptions: ACPConfigOption[],
    ) => reconcileInitialAcpConfigOptions(
      liveConfigOptions,
      options.initialConfigOptions,
      (configId, value) => setAcpSessionConfigValue(
        sessionId,
        entry,
        configId,
        value,
        "ACP_REVIVE_CONFIG",
      ),
      (configId, value, error) => {
        reportError("ACP_REVIVE_CONFIG", error, {
          engine: "acp",
          sessionId,
          configId,
          value,
        });
      },
    );

    const requestedInternalId = options.sessionId?.trim();
    const existing = requestedInternalId ? acpSessions.get(requestedInternalId) : undefined;
    if (requestedInternalId && existing) {
      if (!existing.acpSessionId) {
        const errorDetails = buildAcpErrorDetails(
          new Error("ACP session is still starting and cannot be revived yet."),
          {
            code: "acp_session_start_pending",
            source: "harnss",
            stage: "initialize",
            retryable: true,
          },
        );
        return { error: errorDetails.message, errorDetails };
      }
      rendererBridge.detach(requestedInternalId);
      const resolvedConfigOptions = resolveConfigOptions(
        {},
        requestedInternalId,
        "ACP_REVIVE",
        agentDef.cachedConfigOptions,
      ) as ACPConfigOption[];
      const configOptions = await reconcileRequestedConfig(
        requestedInternalId,
        existing,
        resolvedConfigOptions,
      );
      log("ACP_REVIVE", `Reusing live transport session=${requestedInternalId.slice(0, 8)} agentSession=${existing.acpSessionId.slice(0, 12)}`);
      return {
        sessionId: requestedInternalId,
        agentSessionId: existing.acpSessionId,
        usedLoad: true,
        configOptions,
        mcpStatuses: deriveMcpStatuses(options.mcpServers ?? []),
      };
    }

    let connResult: AcpConnectionResult | null = null;
    let spawnedProcess: ChildProcess | null = null;
    let launchDef: AcpLaunchDefinition | undefined;
    const analyticsProperties = buildAcpAnalyticsProperties(agentDef);
    try {
      const acpMcpServers = await buildAcpMcpServers(options.mcpServers ?? []);
      launchDef = await resolveAcpLaunchDefinition(agentDef, { cwd, mcpServers: acpMcpServers });
      connResult = await createAcpConnection(
        launchDef,
        getMainWindow,
        "ACP_REVIVE",
        (_internalId, proc) => {
          spawnedProcess = proc;
        },
        requestedInternalId,
      );
      const { proc, connection, pendingPermissions, internalId, supportsLoadSession, authMethods } = connResult;

      let acpSessionId: string;
      let usedLoad = false;
      let configOptions: unknown[] = [];

      if (supportsLoadSession && options.agentSessionId) {
        // Restore full context — suppress history replay from reaching the renderer
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId: options.agentSessionId, internalId, analyticsProperties, eventCounter: 0, pendingPermissions, cwd, supportsLoadSession, agentName: agentDef.name, authMethods, isReloading: true, isOfficialPi: launchDef.isOfficialPi === true, adapterVersion: launchDef.adapterVersion, piVersion: launchDef.piVersion, mcpAdapterVersion: launchDef.mcpAdapterVersion, terminalTurnIds: new Set(), turnStates: new Map() };
        acpSessions.set(internalId, entry);
        const loadResult = await withTimeout(connection.loadSession({ sessionId: options.agentSessionId, cwd, mcpServers: acpMcpServers }), ACP_START_TIMEOUT_MS, `${agentDef.name} ACP session/load`);
        entry.isReloading = false;
        acpSessionId = options.agentSessionId;
        usedLoad = true;
        const resolvedConfigOptions = resolveConfigOptions(
          loadResult as typeof loadResult & LegacyAcpSessionConfiguration,
          internalId,
          "ACP_REVIVE",
          agentDef.cachedConfigOptions,
        ) as ACPConfigOption[];
        configOptions = await reconcileRequestedConfig(
          internalId,
          entry,
          resolvedConfigOptions,
        );
        log("ACP_REVIVE", `loadSession OK, session=${acpSessionId.slice(0, 12)} configOptions=${configOptions.length}`);
      } else {
        // Fall back to fresh session — UI messages already restored from disk
        const sessionResult = await withTimeout(connection.newSession({ cwd, mcpServers: acpMcpServers }), ACP_START_TIMEOUT_MS, `${agentDef.name} ACP session/new`);
        acpSessionId = sessionResult.sessionId;
        const entry: ACPSessionEntry = { process: proc, connection, acpSessionId, internalId, analyticsProperties, eventCounter: 0, pendingPermissions, cwd, supportsLoadSession, agentName: agentDef.name, authMethods, isReloading: false, isOfficialPi: launchDef.isOfficialPi === true, adapterVersion: launchDef.adapterVersion, piVersion: launchDef.piVersion, mcpAdapterVersion: launchDef.mcpAdapterVersion, terminalTurnIds: new Set(), turnStates: new Map() };
        acpSessions.set(internalId, entry);
        const resolvedConfigOptions = resolveConfigOptions(
          sessionResult,
          internalId,
          "ACP_REVIVE",
          agentDef.cachedConfigOptions,
        ) as ACPConfigOption[];
        configOptions = await reconcileRequestedConfig(
          internalId,
          entry,
          resolvedConfigOptions,
        );
        log("ACP_REVIVE", `newSession fallback, session=${acpSessionId.slice(0, 12)}`);
      }

      const mcpStatuses = (options.mcpServers ?? []).map(s => ({ name: s.name, status: "connected" as const }));
      return { sessionId: internalId, agentSessionId: acpSessionId, usedLoad, configOptions, mcpStatuses };
    } catch (err) {
      // Kill process and clean up any partial session entry
      killProcessTree(selectAcpStartCleanupProcess(connResult, spawnedProcess ? { process: spawnedProcess } : null));
      if (connResult?.internalId) {
        acpSessions.get(connResult.internalId)?.operationCoordinator?.close("ACP session revival failed.");
        acpSessions.delete(connResult.internalId);
        configBuffer.delete(connResult.internalId);
        commandsBuffer.delete(connResult.internalId);
        rendererBridge.close(connResult.internalId, "ACP session revival failed.");
      }
      const errorDetails = buildAcpLifecycleErrorDetails(err, "acp_revive_failed", "initialize");
      reportError("ACP_REVIVE", err, {
        engine: "acp",
        ...analyticsProperties,
        stage: errorDetails.stage,
        errorCode: errorDetails.code,
        surfacedError: errorDetails.message,
        adapterVersion: launchDef?.adapterVersion,
        piVersion: launchDef?.piVersion,
        mcpAdapterVersion: launchDef?.mcpAdapterVersion,
        mcpServerCount: options.mcpServers?.length ?? 0,
      });
      return { error: errorDetails.message, errorDetails };
    }
  });

  ipcMain.handle("acp:attach-renderer", (_event, sessionId: string) => {
    if (!acpSessions.has(sessionId)) {
      return { error: "ACP session not found." };
    }
    const replayed = rendererBridge.attach(sessionId, (delivery) => {
      safeSend(getMainWindow, delivery.channel, delivery.payload);
    });
    log("ACP_RENDERER_ATTACH", `session=${sessionId.slice(0, 8)} replayed=${replayed}`);
    return { ok: true, replayed };
  });

  ipcMain.handle("acp:prompt", async (_event, { sessionId, text, images }: { sessionId: string; text: string; images?: Array<{ data: string; mediaType: string }> }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_SEND", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return {
        ok: false as const,
        status: "transport_error" as const,
        error: buildAcpErrorDetails(new Error("ACP session not found."), {
          code: "acp_session_not_found",
          source: "harnss",
          stage: "prompt",
          retryable: false,
        }),
        outcomeDelivered: false as const,
      };
    }
    if (!session.acpSessionId) {
      return {
        ok: false as const,
        status: "transport_error" as const,
        error: buildAcpErrorDetails(new Error(buildAuthRequiredError(session.agentName, session.authMethods)), {
          code: "acp_auth_required",
          source: "acp",
          stage: "authenticate",
          retryable: false,
        }),
        outcomeDelivered: false as const,
      };
    }
    const acpSessionId = session.acpSessionId;

    try {
      await rendererBridge.waitUntilAttached(sessionId);
    } catch (err) {
      const message = extractErrorMessage(err);
      log("ACP_SEND", `ERROR: renderer not ready for session=${sessionId.slice(0, 8)}: ${message}`);
      return {
        ok: false as const,
        status: "transport_error" as const,
        error: buildAcpErrorDetails(err, {
          code: "acp_renderer_not_attached",
          source: "harnss",
          stage: "prompt",
          retryable: true,
        }),
        outcomeDelivered: false as const,
      };
    }

    log("ACP_SEND", `session=${sessionId.slice(0, 8)} text=${text.slice(0, 500)} images=${images?.length ?? 0}`);

    const prompt: ContentBlock[] = [];
    if (images) {
      for (const img of images) {
        prompt.push({ type: "image", data: img.data, mimeType: img.mediaType });
      }
    }
    prompt.push({ type: "text", text });

    const turnId = crypto.randomUUID();
    const turnState: AcpTurnState = {
      turnId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      observation: createAcpTurnObservation(),
      stderrError: undefined as string | undefined,
      settled: false,
      cancelRequested: false,
    };
    session.turnStates ??= new Map<string, AcpTurnState>();
    session.turnStates.set(turnId, turnState);
    session.activeUserPrompts = (session.activeUserPrompts ?? 0) + 1;
    try {
      session.hasUserPromptStarted = true;
      turnState.finishRequest = startUtilityRequest(
        (requestEvent) => safeSend(getMainWindow, "usage:upstream-request", requestEvent),
        sessionId,
        "acp",
        "prompt",
        { id: `acp-turn-${turnId}`, turnId, model: getAcpSessionModel(sessionId) },
      );
      log("ACP_TURN_START", {
        session: sessionId.slice(0, 8),
        turnId,
        agentId: session.analyticsProperties.acp_agent,
        adapterVersion: session.adapterVersion,
        piVersion: session.piVersion,
        mcpAdapterVersion: session.mcpAdapterVersion,
      });
      const settled = await getAcpSessionOperationCoordinator(session).runUserPrompt(async () => {
        session.lastStderrError = undefined;
        session.currentTurn = turnState;
        try {
          if (session.isOfficialPi) {
            turnState.piUsageSnapshot = await capturePiAcpTurnSnapshot(acpSessionId);
          }
          const result = await withAcpPromptInactivityTimeout(
            withAcpTurnTransportSignal(
              session.connection.prompt({
                sessionId: acpSessionId,
                prompt,
              }),
              turnState,
            ),
            () => turnState.lastActivityAt,
          );
          const outcome = classifyAcpTurn({
            stopReason: result.stopReason,
            isPi: session.isOfficialPi,
            adapterVersion: session.adapterVersion,
            observation: turnState.observation,
            stderrError: turnState.stderrError ?? session.lastStderrError,
          });
          return { result, outcome };
        } finally {
          if (session.currentTurn === turnState) session.currentTurn = undefined;
        }
      });
      const { result, outcome } = settled;
      const piUsage = turnState.piUsageSnapshot
        ? await readPiAcpTurnUsage(turnState.piUsageSnapshot)
        : undefined;
      const usage = mergeUtilityRequestUsage(
        utilityRequestUsageFromAcp(result.usage, getAcpSessionModel(sessionId)),
        piUsage,
      ) ?? null;
      const canonicalUsage = toCanonicalAcpUsage(usage);
      const canonicalOutcome = toAcpPiTurnOutcome(outcome, turnId, canonicalUsage);
      log("ACP_TURN_COMPLETE", {
        session: sessionId.slice(0, 8),
        turnId,
        agentId: session.analyticsProperties.acp_agent,
        adapterVersion: session.adapterVersion,
        piVersion: session.piVersion,
        mcpAdapterVersion: session.mcpAdapterVersion,
        stage: canonicalOutcome.status === "failed" ? canonicalOutcome.error.stage : "settle",
        status: outcome.status,
        stopReason: outcome.stopReason ?? result.stopReason,
        errorCode: canonicalOutcome.status === "failed" ? canonicalOutcome.error.code : undefined,
        errorSource: canonicalOutcome.status === "failed" ? canonicalOutcome.error.source : undefined,
        retryNoticeCount: turnState.observation.retryNoticeCount,
        meaningfulTextLength: turnState.observation.meaningfulTextLength,
        toolCallCount: turnState.observation.toolCallCount,
        durationMs: Math.max(0, Date.now() - turnState.startedAt),
        model: usage?.model,
        usage,
      });
      if (turnState.settled) {
        if (turnState.outcome) {
          return turnState.outcome.status === "failed"
            ? { ok: false as const, outcome: turnState.outcome, outcomeDelivered: true as const }
            : { ok: true as const, outcome: turnState.outcome, outcomeDelivered: true as const };
        }
        if (turnState.transportError) {
          return {
            ok: false as const,
            status: "transport_error" as const,
            turnId,
            error: turnState.transportError,
            outcomeDelivered: false as const,
          };
        }
      }
      settleAcpTurnOutcome(getMainWindow, session, turnState, canonicalOutcome, usage);

      if (canonicalOutcome.status === "failed") {
        return { ok: false as const, outcome: canonicalOutcome, outcomeDelivered: true as const };
      }
      return { ok: true as const, outcome: canonicalOutcome, outcomeDelivered: true as const };
    } catch (err) {
      if (turnState.settled) {
        if (turnState.outcome) {
          return turnState.outcome.status === "failed"
            ? { ok: false as const, outcome: turnState.outcome, outcomeDelivered: true as const }
            : { ok: true as const, outcome: turnState.outcome, outcomeDelivered: true as const };
        }
        if (turnState.transportError) {
          return {
            ok: false as const,
            status: "transport_error" as const,
            turnId,
            error: turnState.transportError,
            outcomeDelivered: false as const,
          };
        }
      }
      if (turnState.cancelRequested) {
        settleAcpTurnCancelled(getMainWindow, session, turnState);
        return {
          ok: true as const,
          outcome: turnState.outcome ?? { status: "cancelled" as const, turnId, stopReason: "cancelled" as const },
          outcomeDelivered: true as const,
        };
      }
      const stderrMessage = turnState.stderrError || session.lastStderrError;
      const errorDetails = buildAcpPromptTransportErrorDetails(err, {
        isOfficialPi: session.isOfficialPi === true,
        ...(stderrMessage ? { stderrMessage } : {}),
      });
      reportError("ACP_PROMPT_ERR", err, {
        engine: "acp",
        sessionId,
        turnId,
        surfacedError: errorDetails.message,
        errorCode: errorDetails.code,
        adapterVersion: session.adapterVersion,
        piVersion: session.piVersion,
        mcpAdapterVersion: session.mcpAdapterVersion,
      });
      settleAcpTurnTransportError(getMainWindow, session, turnState, errorDetails);
      signalAcpTurnTransportFailure(turnState, errorDetails);
      if (errorDetails.code === "acp_prompt_timeout") {
        log("ACP_TURN_TIMEOUT", {
          session: sessionId.slice(0, 8),
          turnId,
          inactivityTimeoutMs: resolveAcpPromptInactivityTimeoutMs(),
        });
        void session.connection.cancel({ sessionId: acpSessionId })
          .catch(() => undefined)
          .finally(() => killProcessTree(session.process));
        const forceStop = setTimeout(() => killProcessTree(session.process), 500);
        forceStop.unref?.();
      }
      return { ok: false as const, status: "transport_error" as const, turnId, error: errorDetails, outcomeDelivered: false as const };
    } finally {
      if (session.currentTurn === turnState) session.currentTurn = undefined;
      session.activeUserPrompts = Math.max(0, (session.activeUserPrompts ?? 1) - 1);
      session.turnStates?.delete(turnId);
    }
  });

  // Abort an in-flight acp:start (e.g. user clicked stop during npx download).
  // Marks pendingStartProcess as aborted and kills the process — the acp:start
  // catch block will detect `.aborted` and return { cancelled: true }.
  ipcMain.handle("acp:abort-pending-start", async (_event, reason: unknown) => {
    const cancelReason = normalizeAcpStartCancellationReason(reason);
    if (!pendingStartProcess) {
      log("ACP_ABORT_START", `No pending start to abort reason=${cancelReason}`);
      return { ok: false };
    }
    log("ACP_ABORT_START", `Aborting start id=${pendingStartProcess.id.slice(0, 8)} pid=${pendingStartProcess.process.pid} reason=${cancelReason}`);
    pendingStartProcess.aborted = true;
    pendingStartProcess.abortReason = cancelReason;
    killProcessTree(pendingStartProcess.process);
    return { ok: true };
  });

  ipcMain.handle("acp:stop", async (_event, sessionId: string) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      // Fallback: check if this is a pending start that hasn't completed yet
      if (pendingStartProcess?.id === sessionId) {
        log("ACP_STOP", `session=${sessionId?.slice(0, 8)} is pending start — aborting`);
        pendingStartProcess.aborted = true;
        pendingStartProcess.abortReason = "user_stop";
        killProcessTree(pendingStartProcess.process);
        return { ok: true };
      }
      log("ACP_STOP", `session=${sessionId?.slice(0, 8)} already removed`);
      return { ok: true };
    }
    log("ACP_STOP", `session=${sessionId.slice(0, 8)} killing pid=${session.process.pid} total_events=${session.eventCounter}`);
    for (const state of session.turnStates?.values() ?? []) {
      if (!state.settled) {
        state.cancelRequested = true;
        settleAcpTurnCancelled(getMainWindow, session, state);
        signalAcpTurnTransportFailure(state, acpCancellationSignal());
      }
    }
    // Drain pending permissions before killing
    for (const [, resolver] of session.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    session.operationCoordinator?.close("ACP session stopped.");
    killProcessTree(session.process);
    acpSessions.delete(sessionId);
    configBuffer.delete(sessionId);
    commandsBuffer.delete(sessionId);
    rendererBridge.close(sessionId);
    return { ok: true };
  });

  // Reload an existing ACP session with a new MCP server list using session/load.
  // This preserves full conversation context on the agent side — no process restart needed.
  // Returns { ok: true, supportsLoad: true } if successful, { supportsLoad: false } if not supported.
  ipcMain.handle("acp:reload-session", async (_event, { sessionId, mcpServers, cwd }: {
    sessionId: string;
    mcpServers?: McpServerInput[];
    cwd?: string;
  }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_RELOAD", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }
    if (!supportsInProcessMcpReload(session)) {
      const reason = session.isOfficialPi
        ? "built-in Pi MCP configuration is process-scoped"
        : "agent does not support session/load";
      log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} ${reason}, falling back to restart`);
      return { supportsLoad: false };
    }
    if (!session.acpSessionId) {
      return { error: buildAuthRequiredError(session.agentName, session.authMethods), supportsLoad: true };
    }
    const acpSessionId = session.acpSessionId;

    const nextCwd = cwd ?? session.cwd;
    log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} calling loadSession with ${mcpServers?.length ?? 0} MCP server(s) cwd=${nextCwd}`);

    const acpMcpServers = await buildAcpMcpServers(mcpServers ?? []);

    try {
      // Suppress history replay notifications so the renderer doesn't get duplicates
      session.isReloading = true;
      try {
        await withTimeout(session.connection.loadSession({
          sessionId: acpSessionId,
          cwd: nextCwd,
          mcpServers: acpMcpServers,
        }), ACP_START_TIMEOUT_MS, `${session.agentName} ACP session/load`);
      } finally {
        // Always reset — even if loadSession throws or process crashes
        if (acpSessions.has(sessionId)) {
          acpSessions.get(sessionId)!.isReloading = false;
        }
      }
      session.cwd = nextCwd;
      log("ACP_RELOAD", `session=${sessionId.slice(0, 8)} loadSession OK`);
      return { ok: true, supportsLoad: true };
    } catch (err) {
      const msg = reportError("ACP_RELOAD_ERR", err, { engine: "acp", sessionId });
      return { error: msg, supportsLoad: true };
    }
  });

  ipcMain.handle("acp:cancel", async (_event, sessionId: string) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_CANCEL", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    const pendingCount = session.pendingPermissions.size;
    log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} cancelling (${pendingCount} pending permissions)`);

    for (const [, resolver] of session.pendingPermissions) {
      resolver.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    for (const state of session.turnStates?.values() ?? []) {
      state.cancelRequested = true;
    }
    const cancelledQueued = session.operationCoordinator?.cancelQueuedUserPrompts() ?? 0;
    if (cancelledQueued > 0) {
      log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} rejected ${cancelledQueued} queued user prompt(s)`);
    }
    if (!session.acpSessionId) {
      return { ok: true };
    }
    const acpSessionId = session.acpSessionId;

    try {
      await session.connection.cancel({ sessionId: acpSessionId });
      log("ACP_CANCEL", `session=${sessionId.slice(0, 8)} acknowledged`);
      return { ok: true };
    } catch (err) {
      const msg = reportError("ACP_CANCEL_ERR", err, { engine: "acp", sessionId });
      return { error: msg };
    }
  });

  ipcMain.handle("acp:set-config", async (_event, { sessionId, configId, value }: { sessionId: string; configId: string; value: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_CONFIG", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }
    if (!session.acpSessionId) {
      return { error: buildAuthRequiredError(session.agentName, session.authMethods) };
    }
    log("ACP_CONFIG", `session=${sessionId.slice(0, 8)} setting ${configId}=${value}`);
    try {
      const updated = await setAcpSessionConfigValue(
        sessionId,
        session,
        configId,
        value,
        "ACP_CONFIG",
      );
      return { configOptions: updated };
    } catch (err) {
      const errMsg = reportError("ACP_CONFIG_ERR", err, { engine: "acp", sessionId, configId });
      return { error: errMsg };
    }
  });

  // Retrieve buffered config options — used by renderer when useACP first mounts
  // and may have missed config_option_update events during DRAFT→active transition
  ipcMain.handle("acp:get-config-options", async (_event, sessionId: string) => {
    return { configOptions: configBuffer.get(sessionId) ?? [] };
  });

  // Retrieve buffered available commands — same pattern as config options
  ipcMain.handle("acp:get-available-commands", async (_event, sessionId: string) => {
    return { commands: commandsBuffer.get(sessionId) ?? [] };
  });

  ipcMain.handle("acp:permission_response", async (_event, { sessionId, requestId, optionId }: { sessionId: string; requestId: string; optionId: string }) => {
    const session = acpSessions.get(sessionId);
    if (!session) {
      log("ACP_PERMISSION_RESPONSE", `ERROR: session ${sessionId?.slice(0, 8)} not found`);
      return { error: "Session not found" };
    }

    const resolver = session.pendingPermissions.get(requestId);
    if (!resolver) {
      log("ACP_PERMISSION_RESPONSE", `ERROR: session=${sessionId.slice(0, 8)} no pending permission for requestId=${requestId}`);
      return { error: "No pending permission" };
    }

    log("ACP_PERMISSION_RESPONSE", `session=${sessionId.slice(0, 8)} requestId=${requestId} optionId=${optionId}`);
    resolver.resolve({ outcome: { outcome: "selected", optionId } });
    session.pendingPermissions.delete(requestId);
    return { ok: true };
  });
}

/** Stop all ACP sessions (called on app quit). Idempotent. */
export function stopAll(): void {
  for (const [sessionId, entry] of acpSessions) {
    log("CLEANUP", `Stopping ACP session ${sessionId.slice(0, 8)}`);
    for (const state of entry.turnStates?.values() ?? []) {
      if (state.settled) continue;
      state.cancelRequested = true;
      state.settled = true;
      state.outcome = { status: "cancelled", turnId: state.turnId, stopReason: "cancelled" };
      finishAcpTurnRequest(state, false, undefined, {
        code: "acp_cancelled",
        message: "ACP turn cancelled.",
        status: "cancelled",
      });
      signalAcpTurnTransportFailure(state, acpCancellationSignal());
    }
    entry.operationCoordinator?.close("ACP application shutdown.");
    killProcessTree(entry.process);
  }
  acpSessions.clear();
  configBuffer.clear();
  commandsBuffer.clear();
  rendererBridge.closeAll();
}
