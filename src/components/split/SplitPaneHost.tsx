import { useEffect, useState } from "react";
import type { ChatSession, EngineId } from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import type { SessionPaneBootstrap } from "@/hooks/session/types";
import { useExtraPaneLoader } from "@/hooks/session/useExtraPaneLoader";
import { useSessionPane } from "@/hooks/session/useSessionPane";
import { getSessionNotificationActor } from "@/lib/session-notifications";
import {
  publishSplitPaneNotificationSnapshot,
  removeSplitPaneNotificationSnapshot,
} from "@/lib/split-pane-notifications";
import {
  markSplitPaneRoutingNotReady,
  markSplitPaneRoutingReady,
  publishSplitPaneStateSnapshot,
  releaseSplitPaneStateSnapshot,
  retainSplitPaneStateSnapshot,
} from "@/lib/split-pane-state";

interface SplitPaneHostRenderData {
  session: ChatSession | null;
  paneState: SessionPaneState;
}

interface SplitPaneHostProps {
  sessionId: string;
  acpPermissionBehavior: "ask" | "auto_accept" | "allow_all";
  loadBootstrap: (sessionId: string) => Promise<SessionPaneBootstrap | null>;
  reportNotifications?: boolean;
  children: (data: SplitPaneHostRenderData) => React.ReactNode;
}

export function SplitPaneHost({
  sessionId,
  acpPermissionBehavior,
  loadBootstrap,
  reportNotifications = false,
  children,
}: SplitPaneHostProps) {
  const loader = useExtraPaneLoader({
    sessionId,
    loadBootstrap,
  });
  const [publishReadyId, setPublishReadyId] = useState<string | null>(null);

  const readySession = loader.readyId ? loader.session : null;
  const activeEngine: EngineId = readySession?.engine ?? "claude";
  const paneState = useSessionPane({
    activeSessionId: loader.readyId,
    activeEngine,
    claudeSessionId: activeEngine === "claude" ? loader.readyId : null,
    acpSessionId: activeEngine === "acp" ? loader.readyId : null,
    codexSessionId: activeEngine === "codex" ? loader.readyId : null,
    codexSessionModel: activeEngine === "codex" ? readySession?.model : undefined,
    codexPlanModeEnabled: activeEngine === "codex" ? !!readySession?.planMode : false,
    initialMessages: loader.initialMessages,
    initialMeta: loader.initialMeta,
    initialPermission: loader.initialPermission,
    initialConfigOptions: loader.initialConfigOptions,
    initialSlashCommands: loader.initialSlashCommands,
    initialRawAcpPermission: loader.initialRawAcpPermission,
    acpPermissionBehavior,
  });
  const slashCommands = activeEngine === "codex"
    ? paneState.codex.slashCommands
    : activeEngine === "acp"
      ? paneState.acp.slashCommands
      : paneState.claude.slashCommands;

  useEffect(() => {
    setPublishReadyId(null);
    if (!loader.readyId) return;
    const readyId = loader.readyId;
    // Keep global background routing active until the pane's passive engine
    // listeners have had a frame to bind. This makes the handoff lossless.
    let claimed = false;
    const frame = requestAnimationFrame(() => {
      const latest = loader.claimLatest?.();
      if (latest) {
        if (activeEngine === "acp") {
          paneState.acp.hydrate(
            latest.initialMessages,
            latest.initialMeta,
            latest.initialPermission,
            latest.initialRawAcpPermission,
          );
        } else {
          paneState.engine.hydrate(
            latest.initialMessages,
            latest.initialMeta,
            latest.initialPermission,
          );
        }
      }
      if (reportNotifications) {
        markSplitPaneRoutingReady(readyId);
        retainSplitPaneStateSnapshot(readyId);
        claimed = true;
      }
      setPublishReadyId(readyId);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (claimed) {
        markSplitPaneRoutingNotReady(readyId);
        releaseSplitPaneStateSnapshot(readyId);
      }
    };
  }, [loader.claimLatest, loader.readyId, paneState.engine.hydrate, reportNotifications]);

  useEffect(() => {
    if (
      !loader.readyId
      || !reportNotifications
      || publishReadyId !== loader.readyId
      || !readySession
    ) {
      return;
    }
    publishSplitPaneStateSnapshot({
      sessionId: loader.readyId,
      messages: paneState.messages,
      isProcessing: paneState.isProcessing,
      isConnected: paneState.isConnected,
      isCompacting: paneState.isCompacting,
      sessionInfo: paneState.sessionInfo,
      totalCost: paneState.totalCost,
      upstreamRequestCount: paneState.upstreamRequestCount,
      requestLog: paneState.requestLog,
      contextUsage: paneState.contextUsage,
      pendingPermission: paneState.pendingPermission,
      rawAcpPermission: activeEngine === "acp" ? paneState.acp.rawPermission : null,
      configOptions: activeEngine === "acp" ? paneState.acp.configOptions : [],
      slashCommands,
    });
  }, [
    activeEngine,
    loader.readyId,
    paneState.acp.configOptions,
    paneState.acp.rawPermission,
    paneState.contextUsage,
    paneState.isCompacting,
    paneState.isConnected,
    paneState.isProcessing,
    paneState.messages,
    paneState.pendingPermission,
    paneState.requestLog,
    paneState.sessionInfo,
    paneState.totalCost,
    paneState.upstreamRequestCount,
    publishReadyId,
    readySession,
    reportNotifications,
    slashCommands,
  ]);

  useEffect(() => {
    if (
      !reportNotifications
      || !loader.readyId
      || publishReadyId !== loader.readyId
      || !readySession
    ) {
      return;
    }
    publishSplitPaneNotificationSnapshot({
      sessionId: loader.readyId,
      actor: getSessionNotificationActor(readySession, paneState.sessionInfo),
      isProcessing: paneState.isProcessing,
      pendingPermission: paneState.pendingPermission,
      completionEventId: paneState.messages.at(-1)?.id ?? `${loader.readyId}:idle`,
    });
  }, [
    loader.readyId,
    paneState.isProcessing,
    paneState.messages,
    paneState.pendingPermission,
    paneState.sessionInfo,
    publishReadyId,
    readySession,
    reportNotifications,
  ]);

  useEffect(() => {
    if (!reportNotifications || !loader.readyId) return;
    const reportedSessionId = loader.readyId;
    return () => {
      removeSplitPaneNotificationSnapshot(reportedSessionId);
    };
  }, [loader.readyId, reportNotifications]);

  return <>{children({ session: readySession, paneState })}</>;
}
