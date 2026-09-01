/**
 * Owns the renderer state for one chat pane.
 *
 * ACP is the only live runtime. Historical Claude/Codex records still use this
 * pane for displaying their persisted messages, but they never receive a
 * runtime session id and therefore cannot bind any process event listeners.
 */

import { useEffect } from "react";
import { useACP } from "../useACP";
import type {
  UIMessage,
  PermissionRequest,
  EngineId,
  AcpPermissionBehavior,
  ContextUsage,
  SessionInfo,
  ACPConfigOption,
  ACPPermissionEvent,
  SlashCommand,
  UpstreamRequestRecord,
} from "@/types";
import { createSystemMessage } from "@/lib/message-factory";
import {
  SESSION_SEND_FAILURE_EVENT,
  type SessionSendFailureDetail,
} from "@/lib/session-send-failure";
import type { InitialMeta } from "./types";

export interface UseSessionPaneOptions {
  /** The logical session ID for this pane (or null when the pane is unused). */
  activeSessionId: string | null;
  /** Persisted engine identity; only ACP is eligible for a live runtime. */
  activeEngine: EngineId;
  /** ACP process session ID. Must be null for legacy read-only records. */
  acpSessionId: string | null;
  /**
   * Whether this pane is allowed to bind a live ACP process. Keep this
   * explicit instead of inferring it from the display engine: an unknown
   * persisted engine must remain detached and read-only.
   */
  runtimeEnabled?: boolean;
  /** Whether the main process currently owns this session's ACP transport. */
  runtimeAvailable?: boolean;

  // Initial state for session restoration.
  initialMessages: UIMessage[];
  initialMeta: InitialMeta | null;
  initialPermission: PermissionRequest | null;
  initialConfigOptions?: ACPConfigOption[];
  initialSlashCommands?: SlashCommand[];
  initialRawAcpPermission?: ACPPermissionEvent | null;
  acpPermissionBehavior: AcpPermissionBehavior;
}

export type SessionPaneEngine = ReturnType<typeof useACP>;

export interface SessionPaneState {
  /** The only live engine state exposed to pane consumers. */
  acp: SessionPaneEngine;
  /** Alias retained for generic pane code; it always points to ACP state. */
  engine: SessionPaneEngine;

  messages: UIMessage[];
  totalCost: number;
  upstreamRequestCount: number;
  requestLog: UpstreamRequestRecord[];
  contextUsage: ContextUsage | null;
  isProcessing: boolean;
  isConnected: boolean;
  isRuntimeDormant: boolean;
  isCompacting: boolean;
  sessionInfo: SessionInfo | null;
  pendingPermission: PermissionRequest | null;
}

export function resolveAcpInitialRuntimeState(
  runtimeEnabled: boolean,
  initialConfigOptions?: ACPConfigOption[],
  initialSlashCommands?: SlashCommand[],
  initialRawAcpPermission?: ACPPermissionEvent | null,
) {
  if (!runtimeEnabled) {
    return {
      initialConfigOptions: undefined,
      initialSlashCommands: undefined,
      initialRawAcpPermission: null,
    };
  }
  return {
    initialConfigOptions,
    initialSlashCommands,
    initialRawAcpPermission: initialRawAcpPermission ?? null,
  };
}

export function resolveAcpBoundSessionId(
  runtimeEnabled: boolean,
  runtimeAvailable: boolean,
  acpSessionId: string | null,
): string | null {
  return runtimeEnabled && runtimeAvailable ? acpSessionId : null;
}

export function useSessionPane({
  activeSessionId,
  activeEngine,
  acpSessionId,
  runtimeEnabled,
  runtimeAvailable,
  initialMessages,
  initialMeta,
  initialPermission,
  initialConfigOptions,
  initialSlashCommands,
  initialRawAcpPermission,
  acpPermissionBehavior,
}: UseSessionPaneOptions): SessionPaneState {
  const isRuntimeEnabled = runtimeEnabled ?? activeEngine === "acp";
  const isRuntimeAvailable = runtimeAvailable ?? acpSessionId !== null;
  const boundAcpSessionId = resolveAcpBoundSessionId(
    isRuntimeEnabled,
    isRuntimeAvailable,
    acpSessionId,
  );
  const runtimeInitialState = resolveAcpInitialRuntimeState(
    isRuntimeEnabled,
    initialConfigOptions,
    initialSlashCommands,
    initialRawAcpPermission,
  );
  const acp = useACP({
    // A legacy record is deliberately passed null: no old session ID may bind
    // ACP listeners or accidentally send to a removed runtime.
    sessionId: boundAcpSessionId,
    initialMessages,
    // Keep dormant props referentially stable. Fresh [] literals would retrigger
    // useACP's prop-to-state effects on every render and recurse indefinitely.
    initialConfigOptions: runtimeInitialState.initialConfigOptions,
    initialSlashCommands: runtimeInitialState.initialSlashCommands,
    initialMeta,
    initialPermission,
    initialRawAcpPermission: runtimeInitialState.initialRawAcpPermission,
    acpPermissionBehavior,
  });

  useEffect(() => {
    if (!activeSessionId || !isRuntimeEnabled || isRuntimeAvailable) return;
    window.claude.acp.log("SESSION_DORMANT", {
      session: activeSessionId.slice(0, 8),
      cachedConfigOptions: initialConfigOptions?.length ?? 0,
    });
  }, [activeSessionId, initialConfigOptions?.length, isRuntimeAvailable, isRuntimeEnabled]);

  // `useACP` resets on its process id. Legacy and dormant ACP records have no
  // live process id, so hydrate their display state on logical session switches.
  useEffect(() => {
    if (boundAcpSessionId) return;
    acp.hydrate(initialMessages, initialMeta, initialPermission, null);
  }, [acp.hydrate, activeSessionId, boundAcpSessionId, initialMessages, initialMeta, initialPermission]);

  useEffect(() => {
    if (!activeSessionId) return;
    const handleSendFailure = (event: Event) => {
      const detail = (event as CustomEvent<SessionSendFailureDetail>).detail;
      if (!detail || detail.sessionId !== activeSessionId) return;
      acp.setMessages((prev) => [
        ...prev,
        createSystemMessage(detail.message, true),
      ]);
      acp.setIsProcessing(false);
    };
    window.addEventListener(SESSION_SEND_FAILURE_EVENT, handleSendFailure);
    return () => window.removeEventListener(SESSION_SEND_FAILURE_EVENT, handleSendFailure);
  }, [acp.setIsProcessing, acp.setMessages, activeSessionId]);

  return {
    acp,
    engine: acp,
    messages: acp.messages,
    totalCost: acp.totalCost,
    upstreamRequestCount: acp.upstreamRequestCount,
    requestLog: acp.requestLog,
    contextUsage: acp.contextUsage,
    isProcessing: acp.isProcessing,
    isConnected: acp.isConnected,
    isRuntimeDormant: isRuntimeEnabled && !isRuntimeAvailable,
    isCompacting: acp.isCompacting,
    sessionInfo: acp.sessionInfo,
    pendingPermission: acp.pendingPermission,
  };
}
