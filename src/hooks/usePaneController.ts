/**
 * Per-pane controller for the single live runtime (ACP/Pi).
 *
 * Persisted legacy identities are still exposed to the UI so their history can
 * be inspected, but every mutating path is guarded before IPC and all pane
 * state is held by the ACP hook.
 */

import { useMemo } from "react";
import type {
  ACPConfigOption,
  ChatSession,
  EngineId,
  FileReference,
  ImageAttachment,
  InstalledAgent,
} from "@/types";
import type { SessionPaneState } from "@/hooks/session/useSessionPane";
import { DEFAULT_PERMISSION_MODE } from "@/hooks/session/types";
import { continueWeChatSession } from "@/lib/session/wechat-continue";
import { createSystemMessage } from "@/lib/message-factory";
import type { PaneController } from "@/types";
import {
  getSessionRuntimeDisposition,
  INVALID_SESSION_ENGINE_MESSAGE,
  LEGACY_SESSION_READ_ONLY_MESSAGE,
} from "@shared/lib/session-runtime";

export interface PaneControllerContext {
  agents: InstalledAgent[];
  selectedAgent: InstalledAgent | null;
  settings: {
    getModelForEngine: (engine: EngineId) => string;
  };
  handleAgentChange: (agent: InstalledAgent | null) => void;
  handleStop: () => Promise<void>;
  handleComposerClear: () => Promise<void>;
  wrappedHandleSend: (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
    fileReferences?: FileReference[],
  ) => Promise<void>;
  manager: {
    acpConfigOptions: ACPConfigOption[];
    acpConfigOptionsLoading: boolean;
    acpConfigOptionsDormant: boolean;
    setACPConfig: (key: string, value: string) => void;
  };
  splitView?: { setFocusedSession: (sessionId: string | null) => void };
  createSplitPaneDraftSession?: (
    replacedSessionId: string,
    projectId: string,
    agent: InstalledAgent | null,
  ) => Promise<void>;
  queueSplitPaneSendAfterSwitch?: (
    sessionId: string,
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
    fileReferences?: FileReference[],
  ) => Promise<void>;
}

export function usePaneController(
  sessionId: string,
  session: ChatSession | null,
  paneState: SessionPaneState,
  isActiveSessionPane: boolean,
  ctx: PaneControllerContext,
): PaneController {
  return useMemo(() => {
    const disposition = session
      ? getSessionRuntimeDisposition({
          engine: session.invalidEngine ?? session.engine,
          agentId: session.agentId,
        })
      : null;
    const paneEngine: EngineId = disposition?.kind === "legacy-read-only"
      ? disposition.engine
      : "acp";
    const selectedPaneAgent = isActiveSessionPane
      ? ctx.selectedAgent
      : session?.agentId
        ? ctx.agents.find((agent) => agent.id === session.agentId) ?? null
        : null;

    const paneAcpConfigOptions = isActiveSessionPane
      ? ctx.manager.acpConfigOptions
      : paneState.acp.configOptions;
    const paneAcpConfigOptionsLoading = isActiveSessionPane
      ? ctx.manager.acpConfigOptionsLoading
      : paneState.acp.configOptionsLoading;
    const paneAcpConfigOptionsDormant = isActiveSessionPane
      ? ctx.manager.acpConfigOptionsDormant
      : paneState.isRuntimeDormant;
    const configuredModelValue = paneEngine === "acp"
      ? paneAcpConfigOptions
          .find((option) => option.id === "model" || option.category === "model")
          ?.currentValue
      : undefined;
    const configuredModel = typeof configuredModelValue === "string"
      ? configuredModelValue.trim()
      : undefined;
    const liveModel = configuredModel || paneState.sessionInfo?.model?.trim();
    const persistedModel = session?.model?.trim();
    const defaultModel = isActiveSessionPane
      ? ctx.settings.getModelForEngine("acp").trim()
      : "";
    const paneModel = liveModel || persistedModel || defaultModel;
    const panePermissionMode = paneState.sessionInfo?.permissionMode
      ?? session?.permissionMode
      ?? DEFAULT_PERMISSION_MODE;
    const panePlanMode = panePermissionMode === "plan" || !!session?.planMode;

    const handlePaneAgentChange = async (agent: InstalledAgent | null) => {
      if (isActiveSessionPane) {
        ctx.handleAgentChange(agent);
        return;
      }
      if (!session) return;

      const currentAgentId = disposition?.kind === "runtime"
        ? disposition.agentId
        : undefined;
      const wantedAgentId = agent?.id;
      const needsNewSession = disposition?.kind !== "runtime" || currentAgentId !== wantedAgentId;
      if (!needsNewSession) {
        ctx.splitView?.setFocusedSession(sessionId);
        return;
      }
      await ctx.createSplitPaneDraftSession?.(sessionId, session.projectId, agent);
    };

    const handlePaneClear = async () => {
      if (!session) return;
      if (isActiveSessionPane) {
        await ctx.handleComposerClear();
      } else {
        await ctx.createSplitPaneDraftSession?.(sessionId, session.projectId, selectedPaneAgent);
      }
    };

    const handlePaneSend = async (
      text: string,
      images?: ImageAttachment[],
      displayText?: string,
      fileReferences?: FileReference[],
    ) => {
      ctx.splitView?.setFocusedSession(sessionId);
      if (isActiveSessionPane) {
        await ctx.wrappedHandleSend(text, images, displayText, fileReferences);
        return;
      }
      if (!session) return;

      const sendDisposition = getSessionRuntimeDisposition({
        engine: session.invalidEngine ?? session.engine,
        agentId: session.agentId,
      });
      if (sendDisposition.kind !== "runtime") {
        const message = sendDisposition.kind === "legacy-read-only"
          ? LEGACY_SESSION_READ_ONLY_MESSAGE
          : `${INVALID_SESSION_ENGINE_MESSAGE} (${sendDisposition.engine})`;
        paneState.acp.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
        paneState.acp.setIsProcessing(false);
        return;
      }

      if (session.source === "wechat") {
        await continueWeChatSession({
          sessionId,
          text,
          images,
          displayText,
          acp: paneState.acp,
        });
        return;
      }

      if (!paneState.isConnected) {
        await ctx.queueSplitPaneSendAfterSwitch?.(sessionId, text, images, displayText, fileReferences);
        return;
      }
      await paneState.acp.send(text, images, displayText);
    };

    const handlePaneStop = async () => {
      ctx.splitView?.setFocusedSession(sessionId);
      if (isActiveSessionPane) {
        await ctx.handleStop();
        return;
      }
      if (session?.source === "wechat") {
        const result = await window.claude.wechat.cancel({ sessionId });
        if (!result.ok && result.error !== "当前没有正在运行的任务") {
          paneState.acp.setMessages((prev) => [
            ...prev,
            createSystemMessage(result.error || "微信 Pi 会话取消失败。", true),
          ]);
        }
        paneState.acp.setIsProcessing(false);
        return;
      }
      if (session && getSessionRuntimeDisposition({
        engine: session.invalidEngine ?? session.engine,
        agentId: session.agentId,
      }).kind === "runtime") {
        await paneState.acp.interrupt();
      }
    };

    return {
      paneEngine,
      selectedPaneAgent,
      paneModel,
      paneHeaderModel: liveModel || paneModel,
      panePermissionMode,
      panePlanMode,
      paneSlashCommands: paneState.acp.slashCommands,
      paneAcpConfigOptions,
      paneAcpConfigOptionsLoading,
      paneAcpConfigOptionsDormant,
      handlePaneAgentChange,
      handlePaneClear,
      handlePaneSend,
      handlePaneStop,
      handlePaneAcpConfigChange: isActiveSessionPane
        ? ctx.manager.setACPConfig
        : paneState.acp.setConfig,
    };
  }, [ctx, isActiveSessionPane, paneState, session, sessionId]);
}
