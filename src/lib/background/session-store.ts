import type {
  UIMessage,
  SessionInfo,
  PermissionRequest,
  SlashCommand,
  ContextUsage,
  UpstreamRequestRecord,
} from "@/types";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent } from "@/types";
import { handleACPEvent as acpHandler, handleACPTurnComplete as acpTurnComplete, handleACPTransportError as acpTransportError } from "./acp-handler";
import { getUpstreamRequestCount, trimUpstreamRequestLog, upsertUpstreamRequestRecord } from "@/lib/usage/upstream-requests";

export interface BackgroundSessionState {
  messages: UIMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  isCompacting: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  upstreamRequestCount?: number;
  requestLog?: UpstreamRequestRecord[];
  contextUsage: ContextUsage | null;
  pendingPermission: PermissionRequest | null;
  /** Raw ACP permission event — needed for optionId lookup when responding */
  rawAcpPermission: ACPPermissionEvent | null;
  /** Slash commands available for this session (ACP agents update dynamically) */
  slashCommands: SlashCommand[];
  /**
   * Terminal ACP turn IDs already applied to this snapshot. This is an
   * in-memory handoff field, not session-history data; it prevents a replayed
   * terminal event from adding a second error or closing a newer turn.
   */
  terminalAcpTurnIds?: string[];
}

export interface InternalState extends BackgroundSessionState {
  upstreamRequestCount: number;
  requestLog: UpstreamRequestRecord[];
  parentToolMap: Map<string, string>;
  currentStreamingMsgId: string | null;
  /** Bounded terminal ACP turn IDs applied to this state, for idempotence. */
  terminalAcpTurnIdSet: Set<string>;
  /** Active ACP task/subagent — inner tool_calls and text are routed into its card. */
  activeTask: { msgId: string; toolCallId: string; hasInnerTools: boolean; textBuffer: string } | null;
  /** The current turn involved context compaction (used to suppress the unread dot). */
  turnSawCompaction: boolean;
  /** The current turn produced real assistant/tool output (overrides compaction suppression). */
  turnSawOutput: boolean;
}

/** Callback fired when a background session receives a permission request */
type PermissionRequestCallback = (sessionId: string, permission: PermissionRequest) => void;
type PermissionClearedCallback = (sessionId: string) => void;

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Accumulates UIMessages for ACP sessions not currently active in the primary
 * pane. Legacy records may still be hydrated for display, but no retired
 * runtime event is routed through this store.
 */
export class BackgroundSessionStore {
  private sessions = new Map<string, InternalState>();
  onProcessingChange?: (sessionId: string, isProcessing: boolean, suppressUnread?: boolean) => void;
  onPermissionRequest?: PermissionRequestCallback;
  onPermissionCleared?: PermissionClearedCallback;

  private getOrCreate(sessionId: string): InternalState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        messages: [],
        isProcessing: false,
        isConnected: false,
        isCompacting: false,
        sessionInfo: null,
        totalCost: 0,
        upstreamRequestCount: 0,
        requestLog: [],
        contextUsage: null,
        pendingPermission: null,
        rawAcpPermission: null,
        slashCommands: [],
        parentToolMap: new Map(),
        currentStreamingMsgId: null,
        activeTask: null,
        turnSawCompaction: false,
        turnSawOutput: false,
        terminalAcpTurnIdSet: new Set(),
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  handleACPEvent(event: ACPSessionEvent, acceptsPiContextBridge = false): void {
    const sessionId = event._sessionId;
    if (!sessionId) return;

    const state = this.getOrCreate(sessionId);
    acpHandler(state, event, { acceptsPiContextBridge });
  }

  /** Handle ACP turn completion — finalize streaming, close tools, reset processing. */
  handleACPTurnComplete(sessionId: string, event?: ACPTurnCompleteEvent): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (acpTurnComplete(state, event)) {
      this.onProcessingChange?.(sessionId, false);
    }
  }

  handleACPTransportError(sessionId: string, event: import("@/types").ACPTransportErrorEvent): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (acpTransportError(state, event)) {
      this.onProcessingChange?.(sessionId, false);
    }
  }

  recordUpstreamRequest(sessionId: string, record: UpstreamRequestRecord, countDelta?: number): void {
    const state = this.getOrCreate(sessionId);
    const merged = upsertUpstreamRequestRecord(state.requestLog, record);
    state.requestLog = merged.requestLog;
    const increment = countDelta ?? (merged.inserted ? Math.max(1, record.requestCount || 1) : 0);
    if (increment > 0) {
      state.upstreamRequestCount += increment;
    }
  }

  /** Store a pending permission for a background session and fire the callback. */
  setPermission(sessionId: string, permission: PermissionRequest, rawAcpPermission?: ACPPermissionEvent | null): void {
    const state = this.getOrCreate(sessionId);
    state.pendingPermission = permission;
    state.rawAcpPermission = rawAcpPermission ?? null;
    this.onPermissionRequest?.(sessionId, permission);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Read just the processing flag without cloning the (potentially large)
   * messages array. Use this on hot paths like queue-drain checks where only
   * the boolean is needed — `get()` deep-clones every message.
   */
  isProcessing(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isProcessing ?? false;
  }

  get(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Clone messages to prevent external mutation of internal state
    return {
      messages: cloneValue(state.messages),
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      isCompacting: state.isCompacting,
      sessionInfo: cloneValue(state.sessionInfo),
      totalCost: state.totalCost,
      upstreamRequestCount: state.upstreamRequestCount,
      requestLog: cloneValue(trimUpstreamRequestLog(state.requestLog)),
      contextUsage: cloneValue(state.contextUsage),
      pendingPermission: cloneValue(state.pendingPermission),
      rawAcpPermission: cloneValue(state.rawAcpPermission),
      slashCommands: cloneValue(state.slashCommands ?? []),
      terminalAcpTurnIds: Array.from(state.terminalAcpTurnIdSet),
    };
  }

  consume(sessionId: string): BackgroundSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Transfer ownership — no clone needed since we delete the store entry
    this.sessions.delete(sessionId);
    return {
      messages: state.messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      isCompacting: state.isCompacting,
      sessionInfo: state.sessionInfo,
      totalCost: state.totalCost,
      upstreamRequestCount: state.upstreamRequestCount,
      requestLog: trimUpstreamRequestLog(state.requestLog),
      contextUsage: state.contextUsage,
      pendingPermission: state.pendingPermission,
      rawAcpPermission: state.rawAcpPermission,
      slashCommands: state.slashCommands ?? [],
      terminalAcpTurnIds: Array.from(state.terminalAcpTurnIdSet),
    };
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  updateMessages(sessionId: string, updater: (messages: UIMessage[]) => UIMessage[]): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.messages = updater(state.messages);
  }

  setProcessing(sessionId: string, isProcessing: boolean): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.isProcessing === isProcessing) return;
    state.isProcessing = isProcessing;
    this.onProcessingChange?.(sessionId, isProcessing);
  }

  /** Seed slash commands fetched before the draft session has an active renderer. */
  setSlashCommands(sessionId: string, slashCommands: SlashCommand[]): void {
    const state = this.getOrCreate(sessionId);
    state.slashCommands = cloneValue(slashCommands);
  }

  /** Seed store with the current session state when switching away. */
  initFromState(sessionId: string, state: BackgroundSessionState): void {
    const parentToolMap = new Map<string, string>();
    // The active view treats message arrays immutably, so we can reuse the
    // existing objects here and avoid an O(n) clone on every session switch.
    const messages = state.messages;
    let streamingMsg: UIMessage | undefined;

    for (const msg of messages) {
      if (msg.role === "tool_call" && msg.subagentSteps !== undefined) {
        const toolUseId = msg.id.replace(/^tool-/, "");
        parentToolMap.set(toolUseId, msg.id);
      }
      if (msg.role === "assistant" && msg.isStreaming) {
        streamingMsg = msg;
      }
    }

    // 重建 in-flight turn 的 compaction/output 标记。这两个是 turn 级别的标记
    // (每个 `result` 后重置),且只存在于 background store 中,因此从 active view
    // seed 时会丢失。若不处理:在 compaction 进行中切走(例如手动 /compact 的 summary
    // 已插入、但该 turn 的 `result` 尚未到达),「compaction-only」这一事实就会丢失,
    // 随后到达的 `result` 会错误地点亮 unread dot 并触发 completion notification。
    // ACP agents may push a `role: "summary"` message at a compaction boundary,
    // 因此该扫描是 engine-agnostic 的。从尾部反向扫描、在 turn 边界(user 消息)处停止,
    // 可保证只看当前 turn;seed 之后到来的输出会由 live handler 重新置位 `turnSawOutput`。
    let turnSawCompaction = state.isCompacting ?? false;
    let turnSawOutput = false;
    if (state.isProcessing) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === "summary") {
          turnSawCompaction = true;
          break;
        }
        if (m.role === "tool_call" || (m.role === "assistant" && (!!m.content.trim() || !!m.thinking))) {
          turnSawOutput = true;
          break;
        }
        if (m.role === "user") break; // turn 边界 —— 不要串到上一个 turn
      }
    }

    this.sessions.set(sessionId, {
      messages,
      isProcessing: state.isProcessing,
      isConnected: state.isConnected,
      isCompacting: state.isCompacting ?? false,
      sessionInfo: state.sessionInfo ? { ...state.sessionInfo } : null,
      totalCost: state.totalCost,
      upstreamRequestCount: getUpstreamRequestCount(state.requestLog, state.upstreamRequestCount),
      requestLog: cloneValue(trimUpstreamRequestLog(state.requestLog)),
      contextUsage: state.contextUsage ? { ...state.contextUsage } : null,
      pendingPermission: state.pendingPermission ? { ...state.pendingPermission } : null,
      rawAcpPermission: state.rawAcpPermission ?? null,
      slashCommands: state.slashCommands ?? [],
      terminalAcpTurnIdSet: new Set(state.terminalAcpTurnIds ?? []),
      parentToolMap,
      currentStreamingMsgId: streamingMsg?.id ?? null,
      activeTask: null,
      turnSawCompaction,
      turnSawOutput,
    });
  }

  /** Mark a session as disconnected (process exited). */
  markDisconnected(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const hadPendingPermission = state.pendingPermission !== null;
    state.isConnected = false;
    state.isCompacting = false;
    // Dead process = dead permission — clear both
    state.pendingPermission = null;
    state.rawAcpPermission = null;
    if (hadPendingPermission) {
      this.onPermissionCleared?.(sessionId);
    }
    if (state.isProcessing) {
      state.isProcessing = false;
      this.onProcessingChange?.(sessionId, false);
    }
    for (const msg of state.messages) {
      if (msg.isStreaming) {
        msg.isStreaming = false;
      }
    }
  }
}
