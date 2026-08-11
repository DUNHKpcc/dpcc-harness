import { useCallback } from "react";
import type { FileReference, ImageAttachment, McpServerConfig, Project } from "@/types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { fileReferencesToCodexMentions, imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { continueWeChatSession } from "../../lib/session/wechat-continue";
import { buildSdkContent } from "../../lib/engine/protocol";
import { capture } from "../../lib/analytics/analytics";
import { publishSessionSendFailure } from "../../lib/session-send-failure";
import { DRAFT_ID, buildCodexCollabMode } from "./types";
import type {
  EngineHooks,
  MaterializedDraftSession,
  SharedSessionRefs,
  SharedSessionSetters,
  StartOptions,
} from "./types";
import { useSessionCache } from "./useSessionCache";
import { useSessionCrud } from "./useSessionCrud";
import { useSessionSettings } from "./useSessionSettings";
import { useSessionRestart } from "./useSessionRestart";

interface UseSessionLifecycleParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  projects: Project[];
  activeSessionId: string | null;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  // From persistence
  saveCurrentSession: () => Promise<void>;
  seedBackgroundStore: () => void;
  // From draft materialization
  eagerStartSession: (projectId: string, options?: StartOptions) => Promise<void>;
  eagerStartAcpSession: (projectId: string, options?: StartOptions, overrideServers?: McpServerConfig[]) => Promise<void>;
  probeMcpServers: (projectId: string, overrideServers?: McpServerConfig[]) => Promise<void>;
  abandonEagerSession: (reason?: string) => void;
  abandonDraftAcpSession: (reason?: string) => void;
  materializeDraft: (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
  ) => Promise<MaterializedDraftSession | null>;
  // From revival
  reviveSession: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  reviveAcpSession: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  reviveCodexSession: (text: string, images?: ImageAttachment[], fileReferences?: FileReference[]) => Promise<void>;
  // From message queue
  enqueueMessage: (text: string, images?: ImageAttachment[], displayText?: string, fileReferences?: FileReference[]) => void;
  clearQueue: () => void;
  // Codex effort helpers
  resetCodexEffortToModelDefault: (effort: string | undefined) => void;
}

export function useSessionLifecycle({
  refs,
  setters,
  engines,
  projects,
  activeSessionId,
  findProject,
  getProjectCwd,
  saveCurrentSession,
  seedBackgroundStore,
  eagerStartSession,
  eagerStartAcpSession,
  probeMcpServers,
  abandonEagerSession,
  abandonDraftAcpSession,
  materializeDraft,
  reviveSession,
  reviveAcpSession,
  reviveCodexSession,
  enqueueMessage,
  clearQueue,
  resetCodexEffortToModelDefault,
}: UseSessionLifecycleParams) {
  const { claude, acp, codex } = engines;

  // ── Session cache: LRU payload cache, session list loading, model hydration ──
  const {
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
  } = useSessionCache({
    refs,
    setters,
    projects,
    activeSessionId,
    getProjectCwd,
  });

  // ── Session CRUD: create, switch, delete, rename, deselect, import, draft agent ──
  const {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
  } = useSessionCrud({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
    saveCurrentSession,
    seedBackgroundStore,
    eagerStartSession,
    eagerStartAcpSession,
    probeMcpServers,
    abandonEagerSession,
    abandonDraftAcpSession,
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
    clearQueue,
  });

  // ── Session settings: model, permission mode, plan mode, thinking, effort ──
  const {
    setActiveModel,
    setActivePermissionMode,
    setActivePlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    setSessionModel,
    setSessionPermissionMode,
    setSessionPlanMode,
    setSessionClaudeModelAndEffort,
  } = useSessionSettings({
    refs,
    setters,
    engines,
    eagerStartSession,
    abandonEagerSession,
    resetCodexEffortToModelDefault,
  });

  // ── Session restart: ACP restart, worktree restart, full revert ──
  const {
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
  } = useSessionRestart({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
  });

  // ── Send: the main message-sending function (kept here — most intertwined) ──

  const send = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, fileReferences?: FileReference[]) => {
      const activeId = refs.activeSessionIdRef.current;
      const sendEngine = refs.activeSessionIdRef.current === DRAFT_ID
        ? (refs.startOptionsRef.current.engine ?? "claude")
        : (refs.sessionsRef.current.find(s => s.id === refs.activeSessionIdRef.current)?.engine ?? "claude");
      const trackMessageSent = (sessionId?: string) => {
        capture("message_sent", {
          engine: sendEngine,
          has_images: !!images?.length,
          message_length: text.length,
          ...(sendEngine === "acp" && sessionId ? { session_id: sessionId } : {}),
        });
      };

      if (activeId === DRAFT_ID) {
        const draftEngine = refs.startOptionsRef.current.engine ?? "claude";

        if (draftEngine === "acp") {
          refs.pendingAcpDraftPromptRef.current = { text, images, displayText, fileReferences };
          // Show user message + spinner immediately, before the potentially slow materializeDraft
          const userMsg = createUserMessage(text, images, displayText);
          acp.setMessages((prev) => [...prev, userMsg]);
          acp.setIsProcessing(true);

          const materialized = await materializeDraft(text, images, displayText);
          if (!materialized) {
            // materializeDraft failed, was cancelled, or is waiting for auth.
            if (!acp.authRequired) {
              refs.pendingAcpDraftPromptRef.current = null;
            }
            acp.setIsProcessing(false);
            return;
          }
          const { sessionId } = materialized;

          trackMessageSent(sessionId);

          // The main process gates this first prompt on useACP's renderer-attach
          // handshake, so no timing delay is needed during DRAFT materialization.
          try {
            const promptResult = await window.claude.acp.prompt(sessionId, text, images);
            if (promptResult?.error) {
              const message = `ACP prompt error: ${promptResult.error}`;
              if (refs.activeSessionIdRef.current === sessionId) {
                acp.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
                acp.setIsProcessing(false);
              } else {
                publishSessionSendFailure(sessionId, message);
              }
            }
          } catch (err) {
            const message = `ACP prompt error: ${err instanceof Error ? err.message : String(err)}`;
            if (refs.activeSessionIdRef.current === sessionId) {
              acp.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
              acp.setIsProcessing(false);
            } else {
              publishSessionSendFailure(sessionId, message);
            }
          } finally {
            refs.pendingAcpDraftPromptRef.current = null;
          }
          return;
        }

        if (draftEngine === "codex") {
          trackMessageSent();
          const materialized = await materializeDraft(text, images, displayText);
          if (!materialized) return;
          const { sessionId } = materialized;
          const targetPlanMode = materialized.planMode;
          const targetEffort = refs.codexEffortRef.current;
          await new Promise((resolve) => setTimeout(resolve, 50));

          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(targetPlanMode, materialized.model);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (refs.activeSessionIdRef.current === sessionId) {
              codex.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
              codex.setIsProcessing(false);
            } else {
              publishSessionSendFailure(sessionId, message);
            }
            return;
          }
          let sendError: string | undefined;
          try {
            const sendResult = await window.claude.codex.send(
              sessionId,
              text,
              imageAttachmentsToCodexInputs(images),
              targetEffort,
              codexCollabMode,
              fileReferencesToCodexMentions(fileReferences),
            );
            sendError = sendResult?.error;
          } catch (err) {
            sendError = err instanceof Error ? err.message : String(err);
          }
          if (sendError) {
            const message = `Unable to send message: ${sendError}`;
            if (refs.activeSessionIdRef.current === sessionId) {
              codex.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
              codex.setIsProcessing(false);
            } else {
              publishSessionSendFailure(sessionId, message);
            }
          }
          return;
        }

        // Claude SDK path
        trackMessageSent();
        const materialized = await materializeDraft(text, images, displayText);
        if (!materialized) return;
        const { sessionId } = materialized;
        await new Promise((resolve) => setTimeout(resolve, 50));

        {
          const content = buildSdkContent(text, images);
          let sendError: string | undefined;
          try {
            const sendResult = await window.claude.send(sessionId, {
              type: "user",
              message: { role: "user", content },
            });
            sendError = sendResult?.error;
          } catch (err) {
            sendError = err instanceof Error ? err.message : String(err);
          }
          if (sendError) {
            refs.liveSessionIdsRef.current.delete(sessionId);
            const message = `Unable to send message: ${sendError}`;
            if (refs.activeSessionIdRef.current === sessionId) {
              claude.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
              claude.setIsProcessing(false);
            } else {
              publishSessionSendFailure(sessionId, message);
            }
            return;
          }
        }
        return;
      }

      if (!activeId) return;

      // WeChat sessions: continue the conversation through the bridge (which also
      // relays the reply back to the WeChat user). Live events stream back over
      // claude:event tagged with this session id.
      const activeSessionRecord = refs.sessionsRef.current.find((s) => s.id === activeId);
      if (activeSessionRecord?.source === "wechat") {
        trackMessageSent();
        await continueWeChatSession({
          sessionId: activeId,
          engine: activeSessionRecord.engine,
          text,
          images,
          displayText,
          claude,
          codex,
          markLive: (id, live) =>
            live ? refs.liveSessionIdsRef.current.add(id) : refs.liveSessionIdsRef.current.delete(id),
        });
        return;
      }

      // Queue check: if engine is processing, enqueue instead of sending directly
      const activeSessionEngine = refs.sessionsRef.current.find(s => s.id === activeId)?.engine ?? "claude";
      if (refs.isProcessingRef.current && refs.liveSessionIdsRef.current.has(activeId)) {
        trackMessageSent(activeSessionEngine === "acp" ? activeId : undefined);
        enqueueMessage(text, images, displayText, fileReferences);
        return;
      }

      if (activeSessionEngine === "acp") {
        // ACP sessions: send through ACP hook if live
        if (refs.liveSessionIdsRef.current.has(activeId)) {
          if (acp.authRequired) {
            acp.setMessages((prev) => [
              ...prev,
              createSystemMessage("ACP authentication is required before sending another message.", true),
            ]);
            return;
          }
          trackMessageSent(activeId);
          await acp.send(text, images, displayText);
          return;
        }
        // ACP session dead (app restarted) — attempt revival via session/load
        await reviveAcpSession(text, images, displayText);
        return;
      }

      trackMessageSent();

      if (activeSessionEngine === "codex") {
        // Codex sessions: send through Codex hook if live
        if (refs.liveSessionIdsRef.current.has(activeId)) {
          const activeSession = refs.sessionsRef.current.find((s) => s.id === activeId);
          let codexCollabMode: CollaborationMode | undefined;
          try {
            codexCollabMode = buildCodexCollabMode(refs.startOptionsRef.current.planMode, activeSession?.model);
          } catch (err) {
            codex.setMessages((prev) => [
              ...prev,
              createSystemMessage(err instanceof Error ? err.message : String(err), true),
            ]);
            return;
          }
          await codex.send(text, images, displayText, codexCollabMode, fileReferences);
          return;
        }
        // Codex session dead — attempt revival via thread/resume
        await reviveCodexSession(text, images, fileReferences);
        return;
      }

      // Claude SDK path
      if (refs.liveSessionIdsRef.current.has(activeId)) {
        const sent = await claude.send(text, images, displayText);
        if (refs.activeSessionIdRef.current !== activeId) return;
        if (sent) return;
        refs.liveSessionIdsRef.current.delete(activeId);
      }

      if (refs.activeSessionIdRef.current === activeId) {
        await reviveSession(text, images, displayText);
        return;
      }
    },
    [
      claude.send,
      claude.setMessages,
      acp.send,
      acp.setMessages,
      acp.setIsProcessing,
      acp.authRequired,
      codex.send,
      codex.setMessages,
      codex.setIsProcessing,
      materializeDraft,
      reviveSession,
      reviveAcpSession,
      reviveCodexSession,
      enqueueMessage,
    ],
  );

  return {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
    setActiveModel,
    setSessionModel,
    setActivePermissionMode,
    setSessionPermissionMode,
    setActivePlanMode,
    setSessionPlanMode,
    setActiveThinking,
    setActiveClaudeEffort,
    setActiveClaudeModelAndEffort,
    setSessionClaudeModelAndEffort,
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
    send,
  };
}
