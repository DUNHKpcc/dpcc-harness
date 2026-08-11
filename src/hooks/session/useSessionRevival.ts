import { useCallback, useRef } from "react";
import type {
  FileReference,
  ImageAttachment,
  McpServerConfig,
  PersistedSession,
  Project,
  UIMessage,
} from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { fileReferencesToCodexMentions, imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { buildSdkContent } from "../../lib/engine/protocol";
import { capture } from "../../lib/analytics/analytics";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { publishSessionSendFailure } from "../../lib/session-send-failure";
import { useSettingsStore } from "../../stores/settings-store";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  getCodexSandboxMode,
  buildCodexCollabMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseSessionRevivalParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

async function copyPersistedSessionToRuntimeId(
  projectId: string,
  oldId: string,
  newId: string,
  messages: UIMessage[],
  patch: Partial<PersistedSession>,
): Promise<boolean> {
  if (newId === oldId) return false;
  const oldData = await window.claude.sessions.load(projectId, oldId);
  if (!oldData) return false;
  const saveResult = await window.claude.sessions.save({
    ...oldData,
    ...patch,
    id: newId,
    messages,
  });
  if (saveResult?.error) {
    throw new Error(saveResult.error);
  }
  return true;
}

async function deletePersistedSession(projectId: string, sessionId: string): Promise<void> {
  let lastError = "Unable to delete migrated session";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await window.claude.sessions.delete(projectId, sessionId);
      if (!result?.error) return;
      lastError = result.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(lastError);
}

export function useSessionRevival({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
}: UseSessionRevivalParams) {
  const { acp, codex, engine } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    upstreamRequestCountRef,
    requestLogRef,
    contextUsageRef,
    liveSessionIdsRef,
    startOptionsRef,
    codexEffortRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
  } = refs;
  const isSessionCurrent = (...sessionIds: string[]) => {
    const activeId = activeSessionIdRef.current;
    return activeId !== null && sessionIds.includes(activeId);
  };
  const discardRevivedSession = (revivedEngine: "claude" | "acp" | "codex", sessionId: string) => {
    suppressNextSessionCompletion(sessionId);
    if (revivedEngine === "acp") {
      void window.claude.acp.stop(sessionId);
    } else if (revivedEngine === "codex") {
      void window.claude.codex.stop(sessionId);
    } else {
      void window.claude.stop(sessionId, "revival_abandoned");
    }
    liveSessionIdsRef.current.delete(sessionId);
  };
  const revivalGenerationRef = useRef(0);

  const reviveAcpSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const revivalGeneration = ++revivalGenerationRef.current;
      const isCurrentRevival = (...sessionIds: string[]) => (
        revivalGenerationRef.current === revivalGeneration
        && isSessionCurrent(...sessionIds)
      );
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session || !session.agentId) {
        acp.setMessages((prev) => [...prev, createSystemMessage("ACP session disconnected. Please start a new session.", true)]);
        return;
      }
      const project = findProject(session.projectId);
      if (!project) return;

      let mcpServers: McpServerConfig[];
      try {
        mcpServers = await window.claude.mcp.list(session.projectId);
      } catch (err) {
        if (isCurrentRevival(oldId)) {
          acp.setMessages((prev) => [
            ...prev,
            createSystemMessage(
              `Failed to load MCP configuration: ${err instanceof Error ? err.message : String(err)}`,
              true,
            ),
          ]);
        }
        return;
      }
      if (!isCurrentRevival(oldId)) return;
      let result: Awaited<ReturnType<typeof window.claude.acp.reviveSession>>;
      try {
        result = await window.claude.acp.reviveSession({
          agentId: session.agentId,
          cwd: getProjectCwd(project),
          sessionId: oldId,
          agentSessionId: session.agentSessionId,
          mcpServers,
        });
      } catch (err) {
        if (isCurrentRevival(oldId)) {
          acp.setMessages((prev) => [
            ...prev,
            createSystemMessage(
              `Failed to reconnect ACP session: ${err instanceof Error ? err.message : String(err)}`,
              true,
            ),
          ]);
        }
        return;
      }

      if (result.error || !result.sessionId) {
        if (isCurrentRevival(oldId)) {
          acp.setMessages((prev) => [...prev, createSystemMessage(result.error || "Failed to reconnect ACP session. Please start a new session.", true)]);
        }
        return;
      }

      const newId = result.sessionId;
      if (!isCurrentRevival(oldId)) {
        discardRevivedSession("acp", newId);
        return;
      }
      if (newId === oldId) {
        let attachError: string | undefined;
        try {
          const attachResult = await window.claude.acp.attachRenderer(newId);
          attachError = attachResult.error;
        } catch (err) {
          attachError = err instanceof Error ? err.message : String(err);
        }
        if (attachError) {
          discardRevivedSession("acp", newId);
          if (isCurrentRevival(oldId)) {
            acp.setMessages((prev) => [
              ...prev,
              createSystemMessage(`Failed to reconnect ACP session: ${attachError}`, true),
            ]);
          }
          return;
        }
      }
      const revivedMessages = [
        ...messagesRef.current,
        createUserMessage(text, images, displayText),
      ];
      let copiedPersistedSession = false;
      try {
        copiedPersistedSession = await copyPersistedSessionToRuntimeId(
          session.projectId,
          oldId,
          newId,
          revivedMessages,
          { agentSessionId: result.agentSessionId ?? session.agentSessionId },
        );
        if (!isCurrentRevival(oldId)) {
          if (copiedPersistedSession) {
            void window.claude.sessions.delete(session.projectId, newId);
          }
          discardRevivedSession("acp", newId);
          return;
        }
      } catch (err) {
        if (copiedPersistedSession) {
          void window.claude.sessions.delete(session.projectId, newId);
        }
        discardRevivedSession("acp", newId);
        if (isCurrentRevival(oldId)) {
          acp.setMessages((prev) => [
            ...prev,
            createSystemMessage(
              `Failed to prepare reconnected session: ${err instanceof Error ? err.message : String(err)}`,
              true,
            ),
          ]);
        }
        return;
      }
      liveSessionIdsRef.current.delete(oldId);
      liveSessionIdsRef.current.add(newId);
      acpAgentIdRef.current = session.agentId;
      acpAgentSessionIdRef.current = result.agentSessionId ?? session.agentSessionId ?? null;

      setSessions((prev) => prev.map((s) =>
        s.id === oldId
          ? { ...s, id: newId, agentSessionId: result.agentSessionId ?? s.agentSessionId }
          : s,
      ));
      setAcpMcpStatuses((result.mcpStatuses ?? []).map(s => ({
        name: s.name,
        status: toMcpStatusState(s.status),
      })));
      setInitialMessages(revivedMessages);
      const revivedMeta = {
        isProcessing: true,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        upstreamRequestCount: upstreamRequestCountRef.current,
        requestLog: requestLogRef.current,
        contextUsage: contextUsageRef.current,
      };
      setInitialMeta(revivedMeta);
      if (result.configOptions) {
        setInitialConfigOptions(result.configOptions);
        acp.setConfigOptions(result.configOptions);
      }
      if (newId === oldId) {
        acp.hydrate(revivedMessages, revivedMeta, null, null);
      }
      setActiveSessionId(newId);
      let migrationCleanupError: string | undefined;
      if (copiedPersistedSession) {
        try {
          await deletePersistedSession(session.projectId, oldId);
        } catch (err) {
          migrationCleanupError = err instanceof Error ? err.message : String(err);
        }
      }

      if (migrationCleanupError) {
        publishSessionSendFailure(
          newId,
          `Session resumed, but the old history file could not be removed: ${migrationCleanupError}`,
        );
      }
      capture("message_sent", {
        engine: "acp",
        session_id: newId,
        has_images: !!images?.length,
        message_length: text.length,
      });
      let promptError: string | undefined;
      try {
        const promptResult = await window.claude.acp.prompt(newId, text, images);
        promptError = promptResult?.error;
      } catch (err) {
        promptError = err instanceof Error ? err.message : String(err);
      }
      if (promptError) {
        const message = `ACP error: ${promptError}`;
        if (activeSessionIdRef.current === newId) {
          acp.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
          acp.setIsProcessing(false);
        } else {
          publishSessionSendFailure(newId, message);
        }
      }
    },
    [findProject, acp.setMessages, acp.setIsProcessing],
  );

  /** Revive a dead Codex session — spawn new app-server + thread/resume */
  const reviveCodexSession = useCallback(
    async (text: string, images?: ImageAttachment[], fileReferences?: FileReference[]) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const revivalGeneration = ++revivalGenerationRef.current;
      const isCurrentRevival = (...sessionIds: string[]) => (
        revivalGenerationRef.current === revivalGeneration
        && isSessionCurrent(...sessionIds)
      );
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const targetPlanMode = session.planMode ?? false;
      const targetCodexEffort = codexEffortRef.current;
      const project = findProject(session.projectId);
      if (!project) return;

      // Resolve thread ID from in-memory session first, then persisted session.
      let codexThreadId: string | undefined = session.codexThreadId;
      let codexRolloutPath: string | undefined = session.codexRolloutPath;
      if (!codexThreadId || !codexRolloutPath) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, oldId);
          codexThreadId ??= persisted?.codexThreadId;
          codexRolloutPath ??= persisted?.codexRolloutPath;
        } catch { /* ignore */ }
      }
      if (!isCurrentRevival(oldId)) return;

      if (!codexThreadId) {
        codex.setMessages((prev) => [...prev, createSystemMessage("Codex session cannot be resumed (no thread ID). Please start a new session.", true)]);
        return;
      }

      let result: Awaited<ReturnType<typeof window.claude.codex.resume>>;
      try {
        result = await window.claude.codex.resume({
          cwd: getProjectCwd(project),
          threadId: codexThreadId,
          rolloutPath: codexRolloutPath,
          model: session.model,
          permissionMode: session.permissionMode,
          approvalPolicy: getCodexApprovalPolicy({ permissionMode: session.permissionMode }),
          sandbox: getCodexSandboxMode({ permissionMode: session.permissionMode }),
        });
      } catch (err) {
        if (isCurrentRevival(oldId)) {
          codex.setMessages((prev) => [
            ...prev,
            createSystemMessage(
              `Failed to resume Codex session: ${err instanceof Error ? err.message : String(err)}`,
              true,
            ),
          ]);
        }
        return;
      }

      if (result.error || !result.sessionId) {
        if (isCurrentRevival(oldId)) {
          codex.setMessages((prev) => [...prev, createSystemMessage(result.error || "Failed to resume Codex session.", true)]);
        }
        return;
      }

      const newId = result.sessionId;
      if (!isCurrentRevival(oldId)) {
        discardRevivedSession("codex", newId);
        return;
      }
      const revivedMessages = [
        ...messagesRef.current,
        createUserMessage(text, images),
      ];
      const revivedThreadId = result.threadId ?? codexThreadId;
      const revivedRolloutPath = result.rolloutPath ?? codexRolloutPath;
      let copiedPersistedSession = false;
      try {
        copiedPersistedSession = await copyPersistedSessionToRuntimeId(
          session.projectId,
          oldId,
          newId,
          revivedMessages,
          {
            codexThreadId: revivedThreadId,
            codexRolloutPath: revivedRolloutPath,
          },
        );
        if (!isCurrentRevival(oldId)) {
          if (copiedPersistedSession) {
            void window.claude.sessions.delete(session.projectId, newId);
          }
          discardRevivedSession("codex", newId);
          return;
        }
      } catch (err) {
        if (copiedPersistedSession) {
          void window.claude.sessions.delete(session.projectId, newId);
        }
        discardRevivedSession("codex", newId);
        if (isCurrentRevival(oldId)) {
          codex.setMessages((prev) => [
            ...prev,
            createSystemMessage(
              `Failed to prepare resumed session: ${err instanceof Error ? err.message : String(err)}`,
              true,
            ),
          ]);
        }
        return;
      }
      liveSessionIdsRef.current.delete(oldId);
      liveSessionIdsRef.current.add(newId);

      setSessions((prev) => prev.map((s) =>
        s.id === oldId ? {
          ...s,
          id: newId,
          codexThreadId: revivedThreadId,
          codexRolloutPath: revivedRolloutPath,
        } : s,
      ));
      setInitialMessages(revivedMessages);
      setInitialMeta({
        isProcessing: true,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        upstreamRequestCount: upstreamRequestCountRef.current,
        requestLog: requestLogRef.current,
        contextUsage: contextUsageRef.current,
      });
      setActiveSessionId(newId);
      let migrationCleanupError: string | undefined;
      if (copiedPersistedSession) {
        try {
          await deletePersistedSession(session.projectId, oldId);
        } catch (err) {
          migrationCleanupError = err instanceof Error ? err.message : String(err);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      if (migrationCleanupError) {
        publishSessionSendFailure(
          newId,
          `Session resumed, but the old history file could not be removed: ${migrationCleanupError}`,
        );
      }
      let codexCollabMode: CollaborationMode | undefined;
      try {
        codexCollabMode = buildCodexCollabMode(targetPlanMode, session.model);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (activeSessionIdRef.current === newId) {
          codex.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
          codex.setIsProcessing(false);
        } else {
          publishSessionSendFailure(newId, message);
        }
        return;
      }
      let sendError: string | undefined;
      try {
        const sendResult = await window.claude.codex.send(
          newId,
          text,
          imageAttachmentsToCodexInputs(images),
          targetCodexEffort,
          codexCollabMode,
          fileReferencesToCodexMentions(fileReferences),
        );
        sendError = sendResult?.error;
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err);
      }
      if (sendError) {
        const message = `Unable to send message: ${sendError}`;
        if (activeSessionIdRef.current === newId) {
          codex.setMessages((prev) => [...prev, createSystemMessage(message, true)]);
          codex.setIsProcessing(false);
        } else {
          publishSessionSendFailure(newId, message);
        }
      }
    },
    [findProject, codex.setMessages, codex.setIsProcessing],
  );

  // Claude SDK revival — resume session to restore conversation context
  const reviveSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const revivalGeneration = ++revivalGenerationRef.current;
      const isCurrentRevival = (...sessionIds: string[]) => (
        revivalGenerationRef.current === revivalGeneration
        && isSessionCurrent(...sessionIds)
      );
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      const startPayload = {
        cwd: getProjectCwd(project),
        ...(session.model ? { model: session.model } : {}),
        permissionMode: getEffectiveClaudePermissionMode(startOptionsRef.current),
        thinkingEnabled: startOptionsRef.current.thinkingEnabled,
        effort: startOptionsRef.current.effort,
        claudeCodexBridgeEnabled: useSettingsStore.getState().claudeCodexBridgeEnabled,
        resume: oldId, // Resume the SDK session to restore conversation context
      };

      let result;
      try {
        result = await window.claude.start(startPayload);
      } catch (err) {
        if (isCurrentRevival(oldId)) {
          engine.setMessages((prev) => [
            ...prev,
            createSystemMessage(`Failed to resume session: ${err instanceof Error ? err.message : String(err)}`, true),
          ]);
        }
        return;
      }
      if (result.error) {
        if (isCurrentRevival(oldId)) {
          engine.setMessages((prev) => [
            ...prev,
            createSystemMessage(result.error!, true),
          ]);
        }
        return;
      }
      const newSessionId = result.sessionId;
      if (!isCurrentRevival(oldId)) {
        discardRevivedSession("claude", newSessionId);
        return;
      }
      capture("session_revived", { engine: "claude", success: true });
      const revivedMessages = [
        ...messagesRef.current,
        createUserMessage(text, images, displayText),
      ];
      const revivedMeta = {
        isProcessing: true,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        upstreamRequestCount: upstreamRequestCountRef.current,
        requestLog: requestLogRef.current,
        contextUsage: contextUsageRef.current,
      };

      if (newSessionId !== oldId) {
        // SDK returned a different ID (shouldn't happen with resume, but handle
        // it). Complete disk preparation before committing the new ID to the
        // visible session list so an abandoned attempt cannot leave a dead row.
        let oldData;
        let savedNewSession = false;
        try {
          oldData = await window.claude.sessions.load(project.id, oldId);
          if (!isCurrentRevival(oldId)) {
            discardRevivedSession("claude", newSessionId);
            return;
          }
          if (oldData) {
            const saveResult = await window.claude.sessions.save({
              ...oldData,
              id: newSessionId,
              messages: revivedMessages,
              model: session.model ?? oldData.model,
            });
            if (saveResult?.error) {
              throw new Error(saveResult.error);
            }
            savedNewSession = true;
          }
          if (!isCurrentRevival(oldId)) {
            if (savedNewSession) {
              void window.claude.sessions.delete(project.id, newSessionId)
                .catch(() => { /* best-effort rollback */ });
            }
            discardRevivedSession("claude", newSessionId);
            return;
          }
        } catch (err) {
          if (savedNewSession) {
            void window.claude.sessions.delete(project.id, newSessionId)
              .catch(() => { /* best-effort rollback */ });
          }
          discardRevivedSession("claude", newSessionId);
          if (isCurrentRevival(oldId)) {
            engine.setMessages((prev) => [
              ...prev,
              createSystemMessage(
                `Failed to prepare resumed session: ${err instanceof Error ? err.message : String(err)}`,
                true,
              ),
            ]);
          }
          return;
        }

        liveSessionIdsRef.current.delete(oldId);
        liveSessionIdsRef.current.add(newSessionId);
        setInitialMessages(revivedMessages);
        setInitialMeta(revivedMeta);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId
              ? { ...s, id: newSessionId, isActive: true }
              : { ...s, isActive: false },
          ),
        );
        setActiveSessionId(newSessionId);
        if (oldData) {
          try {
            await deletePersistedSession(project.id, oldId);
          } catch (err) {
            publishSessionSendFailure(
              newSessionId,
              `Session resumed, but the old history file could not be removed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } else {
        liveSessionIdsRef.current.add(oldId);
        engine.setMessages(() => revivedMessages);
        engine.setIsProcessing(true);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId ? { ...s, isActive: true } : { ...s, isActive: false },
          ),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      const content = buildSdkContent(text, images);
      let sendError: string | undefined;
      try {
        const sendResult = await window.claude.send(newSessionId, {
          type: "user",
          message: { role: "user", content },
        });
        sendError = sendResult?.error;
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err);
      }
      if (sendError) {
        liveSessionIdsRef.current.delete(newSessionId);
        const message = `Unable to send message: ${sendError}`;
        if (activeSessionIdRef.current === newSessionId) {
          engine.setMessages((prev) => [
            ...prev,
            createSystemMessage(message, true),
          ]);
          engine.setIsProcessing(false);
        } else {
          publishSessionSendFailure(newSessionId, message);
        }
        return;
      }
    },
    [engine.setIsProcessing, engine.setMessages, findProject],
  );

  return {
    reviveSession,
    reviveAcpSession,
    reviveCodexSession,
  };
}
