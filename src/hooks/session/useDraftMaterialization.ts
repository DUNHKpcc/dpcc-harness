import { useCallback, useRef } from "react";
import type { ChatSession, EngineId, ImageAttachment, McpServerConfig, Project } from "../../types";
import { captureException } from "../../lib/analytics/analytics";
import { formatAcpOperationError } from "../../lib/engine/acp-utils";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { toastText } from "../../lib/toast-i18n";
import { normalizeNewSessionIdentity } from "@shared/lib/session-runtime";
import type { ACPStartCancellationReason } from "@shared/types/acp";
import {
  DRAFT_ID,
  type EngineHooks,
  type MaterializedDraftSession,
  type SharedSessionRefs,
  type SharedSessionSetters,
  type StartOptions,
} from "./types";

interface UseDraftMaterializationParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  generateSessionTitle: (sessionId: string, message: string, projectPath: string, engine?: EngineId) => Promise<void>;
}

export function useDraftMaterialization({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
  generateSessionTitle,
}: UseDraftMaterializationParams) {
  const { acp } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialSlashCommands,
    setInitialPermission,
    setInitialRawAcpPermission,
    setDraftProjectId,
    setDraftAcpSessionId,
    setAcpConfigOptionsLoading,
    setDraftMcpStatuses,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    draftProjectIdRef,
    startOptionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    draftAcpSessionIdRef,
    draftMcpStatusesRef,
    materializingRef,
    pendingAcpDraftPromptRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    acpConfigOptionsRef,
    draftGenerationRef,
  } = refs;
  const materializingGenerationRef = useRef<number | null>(null);

  const isCurrentDraftTarget = useCallback((
    projectId: string,
    agentId?: string,
  ) => (
    activeSessionIdRef.current === DRAFT_ID
    && draftProjectIdRef.current === projectId
    && (startOptionsRef.current.engine ?? "acp") === "acp"
    && (agentId === undefined || startOptionsRef.current.agentId === agentId)
  ), []);

  const probeMcpServers = useCallback(async (
    projectId: string,
    overrideServers?: McpServerConfig[],
    draftOptions?: StartOptions,
  ) => {
    const identity = normalizeNewSessionIdentity(draftOptions);
    const isCurrentDraft = () => isCurrentDraftTarget(projectId, identity.agentId);
    try {
      const servers = overrideServers ?? await window.claude.mcp.list();
      if (servers.length === 0) {
        if (isCurrentDraft()) setDraftMcpStatuses([]);
        return;
      }
      if (isCurrentDraft()) {
        setDraftMcpStatuses(servers.map((server) => ({ name: server.name, status: "pending" as const })));
      }
      const results = await window.claude.mcp.probe(servers);
      if (isCurrentDraft()) {
        setDraftMcpStatuses(results.map((result) => ({
          name: result.name,
          status: toMcpStatusState(result.status),
          ...(result.error ? { error: result.error } : {}),
        })));
      }
    } catch (error) {
      captureException(error instanceof Error ? error : new Error(String(error)), { label: "MCP_PROBE_ERR" });
    }
  }, [isCurrentDraftTarget, setDraftMcpStatuses]);

  const abandonDraftAcpSession = useCallback((reason: ACPStartCancellationReason = "cleanup") => {
    ++draftGenerationRef.current;
    const sessionId = draftAcpSessionIdRef.current;
    if (sessionId) {
      suppressNextSessionCompletion(sessionId);
      liveSessionIdsRef.current.delete(sessionId);
      backgroundStoreRef.current.delete(sessionId);
      void window.claude.acp.stop(sessionId);
    } else if (materializingRef.current) {
      void window.claude.acp.abortPendingStart(reason);
    }
    draftAcpSessionIdRef.current = null;
    setDraftAcpSessionId(null);
    pendingAcpDraftPromptRef.current = null;
    acp.clearAuthRequired();
    setAcpConfigOptionsLoading(false);
    if (reason !== "user_stop") {
      setInitialConfigOptions([]);
      setInitialSlashCommands([]);
    }
    setDraftMcpStatuses([]);
  }, [
    acp,
    setAcpConfigOptionsLoading,
    setDraftAcpSessionId,
    setDraftMcpStatuses,
    setInitialConfigOptions,
    setInitialSlashCommands,
  ]);

  const materializeDraft = useCallback(async (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
  ): Promise<MaterializedDraftSession | null> => {
    const generation = draftGenerationRef.current;
    if (materializingRef.current && materializingGenerationRef.current === generation) return null;
    materializingRef.current = true;
    materializingGenerationRef.current = generation;
    const projectId = draftProjectIdRef.current;
    const release = () => {
      if (materializingGenerationRef.current !== generation) return;
      materializingGenerationRef.current = null;
      materializingRef.current = false;
      setAcpConfigOptionsLoading(false);
    };
    const isCurrent = () => (
      materializingGenerationRef.current === generation
      && draftGenerationRef.current === generation
      && activeSessionIdRef.current === DRAFT_ID
      && draftProjectIdRef.current === projectId
    );
    const discard = (sessionId: string) => {
      suppressNextSessionCompletion(sessionId);
      void window.claude.acp.stop(sessionId);
      liveSessionIdsRef.current.delete(sessionId);
      backgroundStoreRef.current.delete(sessionId);
    };

    const project = projectId ? findProject(projectId) : null;
    if (!project) {
      release();
      return null;
    }
    const identity = normalizeNewSessionIdentity(startOptionsRef.current);
    const options: StartOptions = {
      ...startOptionsRef.current,
      engine: "acp",
      agentId: identity.agentId,
      effort: undefined,
    };
    startOptionsRef.current = options;

    let mcpServers: McpServerConfig[];
    try {
      mcpServers = await window.claude.mcp.list();
    } catch (error) {
      captureException(error instanceof Error ? error : new Error(String(error)), { label: "MATERIALIZE_MCP_LIST_ERR" });
      release();
      return null;
    }
    if (!isCurrent()) {
      release();
      return null;
    }

    const cwd = options.cwd ?? getProjectCwd(project);
    setSessions((previous) => [{
      id: DRAFT_ID,
      projectId: project.id,
      title: "New Chat",
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      totalCost: 0,
      requestLog: [],
      permissionMode: options.permissionMode,
      planMode: !!options.planMode,
      isActive: true,
      engine: "acp",
      agentId: identity.agentId,
    }, ...previous.map((session) => ({ ...session, isActive: false }))]);

    let result;
    try {
      setAcpConfigOptionsLoading(true);
      result = await window.claude.acp.start({
        agentId: identity.agentId,
        cwd,
        mcpServers,
        initialConfigOptions: acpConfigOptionsRef.current,
      });
    } catch (error) {
      captureException(error instanceof Error ? error : new Error(String(error)), { label: "MATERIALIZE_ACP_START_ERR" });
      if (isCurrent()) {
        setSessions((previous) => previous.filter((session) => session.id !== DRAFT_ID));
        acp.setMessages((previous) => [
          ...previous,
          createSystemMessage(
            `Failed to start Pi ACP session: ${error instanceof Error ? error.message : String(error)}`,
            true,
          ),
        ]);
      }
      release();
      return null;
    }
    if (!isCurrent()) {
      if ("sessionId" in result && result.sessionId) discard(result.sessionId);
      release();
      return null;
    }
    if ("cancelled" in result && result.cancelled) {
      setSessions((previous) => previous.filter((session) => session.id !== DRAFT_ID));
      acp.setMessages((previous) => [
        ...previous,
        createSystemMessage(
          toastText(result.cancelReason === "user_stop"
            ? "session.piStartCancelledByUser"
            : "session.piStartCancelled"),
          true,
        ),
      ]);
      release();
      return null;
    }
    if (!("sessionId" in result) || !result.sessionId) {
      const errorMessage = formatAcpOperationError(result, "Failed to start Pi ACP session");
      const failedId = `failed-acp-${Date.now()}`;
      const messages = [
        createUserMessage(text, images, displayText),
        createSystemMessage(errorMessage, true),
      ];
      setSessions((previous) => previous.map((session) => (
        session.id === DRAFT_ID ? { ...session, id: failedId, titleGenerating: false } : session
      )));
      setInitialMessages(messages);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: 0,
        requestLog: [],
        contextUsage: null,
      });
      setActiveSessionId(failedId);
      setDraftProjectId(null);
      void window.claude.sessions.save({
        id: failedId,
        projectId: project.id,
        title: "New Chat",
        createdAt: Date.now(),
        messages,
        permissionMode: options.permissionMode,
        planMode: !!options.planMode,
        totalCost: 0,
        requestLog: [],
        engine: "acp",
        agentId: identity.agentId,
      });
      release();
      return null;
    }
    if ("authRequired" in result && result.authRequired) {
      acpAgentIdRef.current = identity.agentId;
      acpAgentSessionIdRef.current = null;
      draftAcpSessionIdRef.current = result.sessionId;
      setDraftAcpSessionId(result.sessionId);
      setInitialMessages([createUserMessage(text, images, displayText)]);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: 0,
        requestLog: [],
        contextUsage: null,
      });
      acp.setAuthMethods(result.authMethods ?? []);
      acp.setAuthRequired(true);
      setAcpConfigOptionsLoading(false);
      release();
      return null;
    }

    const sessionId = result.sessionId;
    const liveConfigOptions = "configOptions" in result
      ? (result.configOptions ?? [])
      : [];
    acpAgentIdRef.current = identity.agentId;
    acpAgentSessionIdRef.current = "agentSessionId" in result && result.agentSessionId
      ? result.agentSessionId
      : null;
    setInitialConfigOptions(liveConfigOptions);
    acp.setConfigOptions(liveConfigOptions);
    setAcpConfigOptionsLoading(false);

    if (!isCurrent()) {
      discard(sessionId);
      release();
      return null;
    }
    liveSessionIdsRef.current.add(sessionId);
    setAcpMcpStatuses(draftMcpStatusesRef.current.length > 0
      ? draftMcpStatusesRef.current
      : mcpServers.map((server) => ({ name: server.name, status: "connected" as const })));

    const now = Date.now();
    const currentBranch = refs.currentBranchRef.current;
    const newSession: ChatSession = {
      id: sessionId,
      projectId: project.id,
      title: "New Chat",
      createdAt: now,
      lastMessageAt: now,
      model: options.model,
      permissionMode: options.permissionMode,
      planMode: !!options.planMode,
      totalCost: 0,
      requestLog: [],
      isActive: true,
      titleGenerating: true,
      ...(currentBranch ? { branch: currentBranch } : {}),
      engine: "acp",
      agentId: identity.agentId,
      agentSessionId: acpAgentSessionIdRef.current ?? undefined,
    };
    setSessions((previous) => [
      newSession,
      ...previous.filter((session) => session.id !== DRAFT_ID).map((session) => ({ ...session, isActive: false })),
    ]);
    setInitialMessages([createUserMessage(text, images, displayText)]);
    setInitialMeta({
      isProcessing: true,
      isConnected: true,
      sessionInfo: null,
      totalCost: 0,
      requestLog: [],
      contextUsage: null,
    });
    setInitialPermission(null);
    setInitialRawAcpPermission(null);
    setActiveSessionId(sessionId);
    acp.clearAuthRequired();
    setDraftAcpSessionId(null);
    setDraftProjectId(null);
    void generateSessionTitle(sessionId, text, cwd, "acp");
    release();
    return {
      sessionId,
      engine: "acp",
      model: options.model,
      planMode: !!options.planMode,
    };
  }, [
    acp,
    findProject,
    generateSessionTitle,
    getProjectCwd,
    refs.currentBranchRef,
    setAcpConfigOptionsLoading,
    setAcpMcpStatuses,
    setActiveSessionId,
    setDraftAcpSessionId,
    setDraftProjectId,
    setInitialConfigOptions,
    setInitialMessages,
    setInitialMeta,
    setInitialPermission,
    setInitialRawAcpPermission,
    setSessions,
  ]);

  return {
    probeMcpServers,
    abandonDraftAcpSession,
    materializeDraft,
  };
}
