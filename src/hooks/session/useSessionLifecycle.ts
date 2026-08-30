import { useCallback } from "react";
import type { FileReference, ImageAttachment, Project } from "@/types";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { continueWeChatSession } from "../../lib/session/wechat-continue";
import { capture } from "../../lib/analytics/analytics";
import { publishSessionSendFailure } from "../../lib/session-send-failure";
import { DRAFT_ID } from "./types";
import type {
  EngineHooks,
  MaterializedDraftSession,
  SharedSessionRefs,
  SharedSessionSetters,
} from "./types";
import { useSessionCache } from "./useSessionCache";
import { useSessionCrud } from "./useSessionCrud";
import { useSessionRestart } from "./useSessionRestart";
import {
  getSessionRuntimeDisposition,
  INVALID_SESSION_ENGINE_MESSAGE,
  LEGACY_SESSION_READ_ONLY_MESSAGE,
  normalizeNewSessionIdentity,
} from "@shared/lib/session-runtime";
import { getAcpPromptTransportErrorMessage, hasAcpPromptTransportEvent } from "@shared/lib/acp-turn";

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
  abandonDraftAcpSession: (reason?: string) => void;
  materializeDraft: (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
  ) => Promise<MaterializedDraftSession | null>;
  reviveAcpSession: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  // From message queue
  enqueueMessage: (text: string, images?: ImageAttachment[], displayText?: string, fileReferences?: FileReference[]) => void;
  clearQueue: () => void;
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
  abandonDraftAcpSession,
  materializeDraft,
  reviveAcpSession,
  enqueueMessage,
  clearQueue,
}: UseSessionLifecycleParams) {
  const { acp } = engines;

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
    abandonDraftAcpSession,
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
    clearQueue,
  });

  // ── Session restart: ACP restart, worktree restart, full revert ──
  const {
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
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
      const activeSessionRecord = activeId && activeId !== DRAFT_ID
        ? refs.sessionsRef.current.find((session) => session.id === activeId)
        : undefined;
      const sendEngine = refs.activeSessionIdRef.current === DRAFT_ID
        ? "acp"
        : (activeSessionRecord?.engine ?? "acp");
      const trackMessageSent = (sessionId?: string) => {
        capture("message_sent", {
          engine: sendEngine,
          has_images: !!images?.length,
          message_length: text.length,
          ...(sendEngine === "acp" && sessionId ? { session_id: sessionId } : {}),
        });
      };

      if (activeId === DRAFT_ID) {
        const identity = normalizeNewSessionIdentity(refs.startOptionsRef.current);
        refs.startOptionsRef.current = {
          ...refs.startOptionsRef.current,
          engine: identity.engine,
          agentId: identity.agentId,
          effort: undefined,
        };
        refs.pendingAcpDraftPromptRef.current = { text, images, displayText, fileReferences };
        const userMsg = createUserMessage(text, images, displayText);
        acp.setMessages((prev) => [...prev, userMsg]);
        acp.setIsProcessing(true);

        const materialized = await materializeDraft(text, images, displayText);
        if (!materialized) {
          if (!acp.authRequired) {
            refs.pendingAcpDraftPromptRef.current = null;
          }
          acp.setIsProcessing(false);
          return;
        }
        const { sessionId } = materialized;

        trackMessageSent(sessionId);
        try {
          const promptResult = await window.claude.acp.prompt(sessionId, text, images);
          const promptError = getAcpPromptTransportErrorMessage(promptResult);
          if (promptError && !hasAcpPromptTransportEvent(promptResult)) {
            const message = `ACP prompt error: ${promptError}`;
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

      if (!activeId) return;
      if (!activeSessionRecord) return;

      // Historical Claude/Codex sessions remain readable, but their runtime is
      // gone. Reject before any WeChat, queue, revive, or IPC path can start it.
      const disposition = getSessionRuntimeDisposition({
        engine: activeSessionRecord.invalidEngine ?? activeSessionRecord.engine,
        agentId: activeSessionRecord.agentId,
      });
      if (disposition.kind !== "runtime") {
        const message = disposition.kind === "legacy-read-only"
          ? LEGACY_SESSION_READ_ONLY_MESSAGE
          : `${INVALID_SESSION_ENGINE_MESSAGE} (${disposition.engine})`;
        acp.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
        acp.setIsProcessing(false);
        return;
      }

      // WeChat sessions: continue the conversation through the bridge (which also
      // relays the reply back to the WeChat user). Live ACP events stream back
      // under this stable PccAgent session id.
      if (activeSessionRecord?.source === "wechat") {
        trackMessageSent();
        await continueWeChatSession({
          sessionId: activeId,
          text,
          images,
          displayText,
          acp,
          markLive: (id, live) =>
            live ? refs.liveSessionIdsRef.current.add(id) : refs.liveSessionIdsRef.current.delete(id),
        });
        return;
      }

      // Queue check: if engine is processing, enqueue instead of sending directly
      if (refs.isProcessingRef.current && refs.liveSessionIdsRef.current.has(activeId)) {
        trackMessageSent(activeId);
        enqueueMessage(text, images, displayText, fileReferences);
        return;
      }

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

      await reviveAcpSession(text, images, displayText);
    },
    [
      acp.send,
      acp.setMessages,
      acp.setIsProcessing,
      acp.authRequired,
      materializeDraft,
      reviveAcpSession,
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
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    send,
  };
}
