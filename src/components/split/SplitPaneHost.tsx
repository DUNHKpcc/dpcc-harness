import { useEffect } from "react";
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

  useEffect(() => {
    if (!reportNotifications || !loader.readyId || !readySession) return;
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
