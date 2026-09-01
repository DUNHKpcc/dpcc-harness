import { useCallback, useRef } from "react";
import type {
  ImageAttachment,
  McpServerConfig,
  PersistedSession,
  Project,
  UIMessage,
} from "../../types";
import { capture } from "../../lib/analytics/analytics";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { publishSessionSendFailure } from "../../lib/session-send-failure";
import {
  BUILTIN_PI_AGENT_ID,
  getSessionRuntimeDisposition,
  INVALID_SESSION_ENGINE_MESSAGE,
  LEGACY_SESSION_READ_ONLY_MESSAGE,
} from "@shared/lib/session-runtime";
import { getAcpPromptTransportErrorMessage, hasAcpPromptTransportEvent } from "@shared/lib/acp-turn";
import { formatAcpOperationError } from "../../lib/engine/acp-utils";
import { DRAFT_ID, type EngineHooks, type SharedSessionRefs, type SharedSessionSetters } from "./types";

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
  const result = await window.claude.sessions.save({
    ...oldData,
    ...patch,
    id: newId,
    messages,
  });
  if (result?.error) throw new Error(result.error);
  return true;
}

async function deletePersistedSession(projectId: string, sessionId: string): Promise<void> {
  let lastError = "Unable to delete migrated session";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await window.claude.sessions.delete(projectId, sessionId);
      if (!result?.error) return;
      lastError = result.error;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100));
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
  const { acp } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpConfigOptionsLoading,
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
    acpAgentIdRef,
    acpAgentSessionIdRef,
    acpConfigOptionsRef,
  } = refs;
  const revivalGenerationRef = useRef(0);

  const legacyMessageFor = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    const disposition = getSessionRuntimeDisposition({
      engine: session?.invalidEngine ?? session?.engine,
      agentId: session?.agentId,
    });
    return disposition.kind === "invalid"
      ? `${INVALID_SESSION_ENGINE_MESSAGE} (${disposition.engine})`
      : LEGACY_SESSION_READ_ONLY_MESSAGE;
  }, []);

  const rejectLegacyRevival = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || sessionId === DRAFT_ID) return;
    acp.setMessages((previous) => [...previous, createSystemMessage(legacyMessageFor(sessionId), true)]);
    acp.setIsProcessing(false);
  }, [acp.setIsProcessing, acp.setMessages, legacyMessageFor]);

  const reviveAcpSession = useCallback(async (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
  ) => {
    const oldId = activeSessionIdRef.current;
    if (!oldId || oldId === DRAFT_ID) return;
    const session = sessionsRef.current.find((item) => item.id === oldId);
    const disposition = getSessionRuntimeDisposition({
      engine: session?.invalidEngine ?? session?.engine,
      agentId: session?.agentId,
    });
    if (disposition.kind !== "runtime") {
      rejectLegacyRevival();
      return;
    }
    if (!session) return;

    const generation = ++revivalGenerationRef.current;
    const isCurrent = (...sessionIds: string[]) => (
      revivalGenerationRef.current === generation
      && activeSessionIdRef.current !== null
      && sessionIds.includes(activeSessionIdRef.current)
    );
    const project = findProject(session.projectId);
    if (!project) return;

    let mcpServers: McpServerConfig[];
    try {
      mcpServers = await window.claude.mcp.list();
    } catch (error) {
      if (isCurrent(oldId)) {
        acp.setMessages((previous) => [...previous, createSystemMessage(
          `Failed to load MCP configuration: ${error instanceof Error ? error.message : String(error)}`,
          true,
        )]);
      }
      return;
    }
    if (!isCurrent(oldId)) return;

    const agentId = disposition.agentId || BUILTIN_PI_AGENT_ID;
    let result: Awaited<ReturnType<typeof window.claude.acp.reviveSession>>;
    setAcpConfigOptionsLoading(true);
    try {
      result = await window.claude.acp.reviveSession({
        agentId,
        cwd: getProjectCwd(project),
        sessionId: oldId,
        agentSessionId: session.agentSessionId,
        mcpServers,
        initialConfigOptions: acpConfigOptionsRef.current,
      });
    } catch (error) {
      if (isCurrent(oldId)) {
        setAcpConfigOptionsLoading(false);
        acp.setMessages((previous) => [...previous, createSystemMessage(
          `Failed to reconnect ACP session: ${error instanceof Error ? error.message : String(error)}`,
          true,
        )]);
      }
      return;
    }
    if (result.error || !result.sessionId) {
      if (isCurrent(oldId)) {
        setAcpConfigOptionsLoading(false);
        acp.setMessages((previous) => [...previous, createSystemMessage(
          formatAcpOperationError(
            result,
            "Failed to reconnect ACP session. Please start a new session.",
          ),
          true,
        )]);
      }
      return;
    }

    const newId = result.sessionId;
    const discard = () => {
      suppressNextSessionCompletion(newId);
      void window.claude.acp.stop(newId);
      liveSessionIdsRef.current.delete(newId);
    };
    if (!isCurrent(oldId)) {
      discard();
      return;
    }
    const revivedMessages = [...messagesRef.current, createUserMessage(text, images, displayText)];
    let copied = false;
    try {
      copied = await copyPersistedSessionToRuntimeId(
        session.projectId,
        oldId,
        newId,
        revivedMessages,
        {
          engine: "acp",
          agentId,
          agentSessionId: result.agentSessionId ?? session.agentSessionId,
        },
      );
      if (!isCurrent(oldId)) {
        if (copied) void window.claude.sessions.delete(session.projectId, newId);
        discard();
        return;
      }
    } catch (error) {
      if (copied) void window.claude.sessions.delete(session.projectId, newId);
      discard();
      if (isCurrent(oldId)) {
        setAcpConfigOptionsLoading(false);
        acp.setMessages((previous) => [...previous, createSystemMessage(
          `Failed to prepare reconnected session: ${error instanceof Error ? error.message : String(error)}`,
          true,
        )]);
      }
      return;
    }

    liveSessionIdsRef.current.delete(oldId);
    liveSessionIdsRef.current.add(newId);
    acpAgentIdRef.current = agentId;
    acpAgentSessionIdRef.current = result.agentSessionId ?? session.agentSessionId ?? null;
    setSessions((previous) => previous.map((item) => item.id === oldId
      ? {
        ...item,
        id: newId,
        engine: "acp",
        agentId,
        agentSessionId: result.agentSessionId ?? item.agentSessionId,
      }
      : item));
    setAcpMcpStatuses((result.mcpStatuses ?? []).map((status) => ({
      name: status.name,
      status: toMcpStatusState(status.status),
    })));
    const revivedMeta = {
      isProcessing: true,
      isConnected: true,
      sessionInfo: null,
      totalCost: totalCostRef.current,
      upstreamRequestCount: upstreamRequestCountRef.current,
      requestLog: requestLogRef.current,
      contextUsage: contextUsageRef.current,
    };
    const revivedConfigOptions = result.configOptions ?? [];
    setInitialMessages(revivedMessages);
    setInitialMeta(revivedMeta);
    setInitialConfigOptions(revivedConfigOptions);
    setAcpConfigOptionsLoading(false);
    acp.setConfigOptions(revivedConfigOptions);
    if (newId === oldId) acp.hydrate(revivedMessages, revivedMeta, null, null);
    setActiveSessionId(newId);

    if (copied) {
      try {
        await deletePersistedSession(session.projectId, oldId);
      } catch (error) {
        publishSessionSendFailure(
          newId,
          `Session resumed, but the old history file could not be removed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    capture("message_sent", {
      engine: "acp",
      session_id: newId,
      has_images: !!images?.length,
      message_length: text.length,
    });
    try {
      const promptResult = await window.claude.acp.prompt(newId, text, images);
      const promptError = hasAcpPromptTransportEvent(promptResult)
        ? undefined
        : getAcpPromptTransportErrorMessage(promptResult);
      if (promptError) throw new Error(promptError);
    } catch (error) {
      const message = `ACP error: ${error instanceof Error ? error.message : String(error)}`;
      if (activeSessionIdRef.current === newId) {
        acp.setMessages((previous) => [...previous, createSystemMessage(message, true)]);
        acp.setIsProcessing(false);
      } else {
        publishSessionSendFailure(newId, message);
      }
    }
  }, [
    acp,
    findProject,
    getProjectCwd,
    rejectLegacyRevival,
    setAcpConfigOptionsLoading,
    setAcpMcpStatuses,
    setActiveSessionId,
    setInitialConfigOptions,
    setInitialMessages,
    setInitialMeta,
    setSessions,
  ]);

  return { reviveAcpSession };
}
