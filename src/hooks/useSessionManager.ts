import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatSession, UIMessage, PermissionRequest, McpServerStatus, McpServerConfig, AcpPermissionBehavior, EngineId, Project, ACPAuthenticateResult, ACPConfigOption, ACPPermissionEvent, InstalledAgent } from "@/types";
import { toMcpStatusState } from "../lib/mcp-utils";
import {
  normalizePersistedSessionForDisplay,
  toChatSession,
} from "../lib/session/records";
import {
  getChatModuleProject,
  isChatModuleProjectId,
  withChatModuleProjectIds,
} from "../lib/session/chat-module";
import { BackgroundSessionStore } from "../lib/background/session-store";
import { createSystemMessage } from "../lib/message-factory";
import { suppressNextSessionCompletion } from "../lib/notification-utils";
import { getSplitPaneStateSnapshot } from "../lib/split-pane-state";
import {
  DRAFT_ID,
  type StartOptions,
  type InitialMeta,
  type PendingAcpDraftPrompt,
  type QueuedMessage,
  type SessionPaneBootstrap,
  type SharedSessionRefs,
  type SharedSessionSetters,
  type EngineHooks,
} from "./session/types";
import { useSessionPane } from "./session/useSessionPane";
import { useMessageQueue } from "./session/useMessageQueue";
import { useSessionPersistence } from "./session/useSessionPersistence";
import { useDraftMaterialization } from "./session/useDraftMaterialization";
import { useSessionRevival } from "./session/useSessionRevival";
import { useSessionLifecycle } from "./session/useSessionLifecycle";
import {
  getSessionRuntimeDisposition,
  newPiSessionIdentity,
} from "@shared/lib/session-runtime";
import { getAcpPromptTransportErrorMessage, hasAcpPromptTransportEvent } from "@shared/lib/acp-turn";
import {
  areAcpSlashCommandsEqual,
  areAcpConfigOptionsEqual,
  getAgentCachedConfigOptions,
  getAgentCachedSlashCommands,
} from "@shared/lib/acp-config-cache";
import { BUILTIN_PI_AGENT_ID } from "@shared/types/registry";

export function useSessionManager(
  projects: Project[],
  acpPermissionBehavior: AcpPermissionBehavior = "ask",
  onSpaceChange?: (spaceId: string) => void,
  /** Session IDs currently visible in extra split panes. */
  visibleSplitSessionIds: readonly string[] = [],
  installedAgents: readonly InstalledAgent[] = [],
) {
  // ── Core state ──
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [startOptions, setStartOptions] = useState<StartOptions>(() => ({
    ...newPiSessionIdentity(),
  }));
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [initialMeta, setInitialMeta] = useState<InitialMeta | null>(null);
  const [initialConfigOptions, setInitialConfigOptions] = useState<ACPConfigOption[]>([]);
  const [initialSlashCommands, setInitialSlashCommands] = useState<import("@/types").SlashCommand[]>([]);
  const [initialPermission, setInitialPermission] = useState<PermissionRequest | null>(null);
  const [initialRawAcpPermission, setInitialRawAcpPermission] = useState<ACPPermissionEvent | null>(null);
  const [acpMcpStatuses, setAcpMcpStatuses] = useState<McpServerStatus[]>([]);
  const [acpConfigOptionsLoading, setAcpConfigOptionsLoading] = useState(false);
  const [draftAcpSessionId, setDraftAcpSessionId] = useState<string | null>(null);
  const [draftMcpStatuses, setDraftMcpStatuses] = useState<McpServerStatus[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);

  // ── Refs needed by extra pane loaders (declared early) ──
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const installedAgentsRef = useRef<readonly InstalledAgent[]>(installedAgents);
  installedAgentsRef.current = installedAgents;
  const liveSessionIdsRef = useRef<Set<string>>(new Set());
  const backgroundStoreRef = useRef(new BackgroundSessionStore());

  useEffect(() => {
    if (visibleSplitSessionIds.length === 0) return;
    const visibleIds = new Set(visibleSplitSessionIds);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        if (!visibleIds.has(session.id) || !session.hasUnreadCompletion) return session;
        changed = true;
        return { ...session, hasUnreadCompletion: false };
      });
      return changed ? next : prev;
    });
  }, [visibleSplitSessionIds]);

  // ── Determine active engine ──
  // The display engine is not the runtime authorization decision. In
  // particular, an unknown persisted value gets a neutral ACP display shape
  // but remains detached through `runtimeEnabled` below.
  const activeRecord = activeSessionId && activeSessionId !== DRAFT_ID
    ? sessions.find((session) => session.id === activeSessionId)
    : undefined;
  const activeDisposition = activeRecord
    ? getSessionRuntimeDisposition({
        engine: activeRecord.invalidEngine ?? activeRecord.engine,
        agentId: activeRecord.agentId,
      })
    : null;
  const isDraft = activeSessionId === DRAFT_ID;
  const activeRuntimeAgentId = isDraft
    ? (startOptions.agentId ?? newPiSessionIdentity().agentId)
    : activeDisposition?.kind === "runtime"
      ? activeDisposition.agentId
      : null;
  const runtimeEnabled = isDraft || activeDisposition?.kind === "runtime";
  const activeEngine: EngineId = isDraft
    ? "acp"
    : activeDisposition?.kind === "runtime"
      ? "acp"
      : activeDisposition?.kind === "legacy-read-only"
        ? activeDisposition.engine
        : "acp";

  const runtimeSessionId = activeSessionId !== DRAFT_ID ? activeSessionId : draftAcpSessionId;
  const runtimeAvailable = runtimeEnabled && runtimeSessionId !== null && (
    isDraft || liveSessionIdsRef.current.has(runtimeSessionId)
  );
  const acpSessionId = runtimeAvailable ? runtimeSessionId : null;

  // ── Primary session pane ──
  const primaryPane = useSessionPane({
    activeSessionId,
    activeEngine,
    runtimeEnabled,
    runtimeAvailable,
    acpSessionId,
    initialMessages,
    initialMeta,
    initialPermission,
    initialConfigOptions,
    initialSlashCommands,
    initialRawAcpPermission,
    acpPermissionBehavior,
  });

  const { acp, engine } = primaryPane;
  const { messages, totalCost, upstreamRequestCount, requestLog, contextUsage } = primaryPane;

  // ── All refs (21+) — kept for stale-closure avoidance ──
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  const upstreamRequestCountRef = useRef(upstreamRequestCount);
  upstreamRequestCountRef.current = upstreamRequestCount;
  const requestLogRef = useRef(requestLog);
  requestLogRef.current = requestLog;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  // sessionsRef declared above (near extra pane loaders)
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const draftProjectIdRef = useRef(draftProjectId);
  draftProjectIdRef.current = draftProjectId;
  const startOptionsRef = useRef(startOptions);
  startOptionsRef.current = startOptions;
  const isProcessingRef = useRef(engine.isProcessing);
  isProcessingRef.current = engine.isProcessing;
  const isCompactingRef = useRef("isCompacting" in engine ? !!engine.isCompacting : false);
  isCompactingRef.current = "isCompacting" in engine ? !!engine.isCompacting : false;
  const isConnectedRef = useRef(engine.isConnected);
  isConnectedRef.current = engine.isConnected;
  const sessionInfoRef = useRef(engine.sessionInfo);
  sessionInfoRef.current = engine.sessionInfo;
  const pendingPermissionRef = useRef(engine.pendingPermission);
  pendingPermissionRef.current = engine.pendingPermission;
  const acpConfigOptionsRef = useRef(acp.configOptions);
  acpConfigOptionsRef.current = acp.configOptions;
  // Prevent cross-session bleed: skip the first lastMessageAt sync after switching chats.
  const lastMessageSyncSessionRef = useRef<string | null>(null);
  const draftAcpSessionIdRef = useRef<string | null>(null);
  draftAcpSessionIdRef.current = draftAcpSessionId;
  const draftMcpStatusesRef = useRef<McpServerStatus[]>([]);
  draftMcpStatusesRef.current = draftMcpStatuses;
  const draftGenerationRef = useRef(0);
  const materializingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<Map<string, QueuedMessage[]>>(new Map());
  const pendingAcpDraftPromptRef = useRef<PendingAcpDraftPrompt | null>(null);
  const acpAgentIdRef = useRef<string | null>(null);
  const acpAgentSessionIdRef = useRef<string | null>(null);
  const acpPermissionBehaviorRef = useRef<AcpPermissionBehavior>(acpPermissionBehavior);
  acpPermissionBehaviorRef.current = acpPermissionBehavior;
  const currentBranchRef = useRef<string | undefined>(undefined);
  // Stable ref to switchSession so toast callbacks don't capture stale closures
  const switchSessionRef = useRef<((id: string) => Promise<void>) | undefined>(undefined);
  // Stable ref for space switching — avoids adding onSpaceChange as a useCallback dependency
  const onSpaceChangeRef = useRef(onSpaceChange);
  onSpaceChangeRef.current = onSpaceChange;
  // backgroundStoreRef declared above (near extra pane loaders)

  // ── Utility callbacks ──
  const findProject = useCallback((projectId: string) => {
    if (isChatModuleProjectId(projectId)) return getChatModuleProject();
    return projectsRef.current.find((p) => p.id === projectId) ?? null;
  }, []);

  const getProjectCwd = useCallback((project: Project) => {
    if (isChatModuleProjectId(project.id)) return project.path;
    const selected = localStorage.getItem(`pcc-agent-${project.id}-git-cwd`)?.trim();
    return selected || project.path;
  }, []);

  // ── Build shared refs/setters/engines objects for sub-hooks ──
  const refs: SharedSessionRefs = {
    activeSessionIdRef,
    sessionsRef,
    installedAgentsRef,
    projectsRef,
    draftProjectIdRef,
    startOptionsRef,
    messagesRef,
    totalCostRef,
    upstreamRequestCountRef,
    requestLogRef,
    contextUsageRef,
    isProcessingRef,
    isCompactingRef,
    isConnectedRef,
    sessionInfoRef,
    pendingPermissionRef,
    acpConfigOptionsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    draftAcpSessionIdRef,
    draftMcpStatusesRef,
    materializingRef,
    saveTimerRef,
    messageQueueRef,
    pendingAcpDraftPromptRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    onSpaceChangeRef,
    acpPermissionBehaviorRef,
    currentBranchRef,
    draftGenerationRef,
  };

  const setters: SharedSessionSetters = {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialSlashCommands,
    setInitialPermission,
    setInitialRawAcpPermission,
    setStartOptions,
    setDraftProjectId,
    setDraftAcpSessionId,
    setAcpConfigOptionsLoading,
    setDraftMcpStatuses,
    setAcpMcpStatuses,
    setQueuedCount,
  };

  const engines: EngineHooks = {
    acp,
    engine,
  };

  // Agent registry loading is asynchronous. Publish cached draft controls as
  // soon as it arrives, but never replace state from a live runtime.
  useEffect(() => {
    if (
      !activeSessionId
      || !activeRuntimeAgentId
      || runtimeAvailable
    ) {
      return;
    }
    const cachedConfigOptions = getAgentCachedConfigOptions(
      installedAgents,
      activeRuntimeAgentId,
    );
    const cachedSlashCommands = getAgentCachedSlashCommands(
      installedAgents,
      activeRuntimeAgentId,
    );
    setInitialConfigOptions((current) => (
      current.length > 0 || areAcpConfigOptionsEqual(current, cachedConfigOptions)
        ? current
        : cachedConfigOptions
    ));
    setInitialSlashCommands((current) => (
      current.length > 0 || areAcpSlashCommandsEqual(current, cachedSlashCommands)
        ? current
        : cachedSlashCommands
    ));
    setAcpConfigOptionsLoading(false);
  }, [activeRuntimeAgentId, activeSessionId, installedAgents, runtimeAvailable]);

  const commandCatalogProjectId = isDraft ? draftProjectId : activeRecord?.projectId;
  useEffect(() => {
    if (
      !activeSessionId
      || !commandCatalogProjectId
      || activeRuntimeAgentId !== BUILTIN_PI_AGENT_ID
      || runtimeAvailable
    ) {
      return;
    }
    const project = findProject(commandCatalogProjectId);
    if (!project) return;
    const targetSessionId = activeSessionId;
    let cancelled = false;
    void window.claude.agents.listPiDraftCommands(getProjectCwd(project)).then(({ commands }) => {
      if (
        cancelled
        || activeSessionIdRef.current !== targetSessionId
        || (targetSessionId === DRAFT_ID
          ? draftAcpSessionIdRef.current !== null
          : liveSessionIdsRef.current.has(targetSessionId))
      ) {
        return;
      }
      setInitialSlashCommands((current) => (
        areAcpSlashCommandsEqual(current, commands) ? current : commands
      ));
    }).catch(() => {
      // The built-in command cache remains usable if local resource discovery fails.
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeRuntimeAgentId,
    activeSessionId,
    commandCatalogProjectId,
    findProject,
    getProjectCwd,
    installedAgents,
    runtimeAvailable,
  ]);

  // ── Compose sub-hooks ──
  const {
    enqueueMessage,
    clearQueue,
    unqueueMessage,
    sendQueuedMessageNext,
    continueQueuedBackgroundSession,
    sendNextId,
  } = useMessageQueue({ refs, setters, engines, activeSessionId });

  const { saveCurrentSession, seedBackgroundStore, generateSessionTitle } = useSessionPersistence({
    refs,
    setters,
    engines,
    activeSessionId,
    continueQueuedBackgroundSession,
  });

  const {
    probeMcpServers,
    abandonDraftAcpSession,
    materializeDraft,
  } =
    useDraftMaterialization({
      refs,
      setters,
      engines,
      findProject,
      getProjectCwd,
      generateSessionTitle,
    });

  const { reviveAcpSession } = useSessionRevival({
    refs,
    setters,
    engines,
    findProject,
    getProjectCwd,
  });

  const {
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
  } = useSessionLifecycle({
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
  });

  const seedDevExampleConversation = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    const { buildDevExampleConversation } = await import("../lib/dev-seeding/chat-seed");
    const base = Date.now();
    const seeded = buildDevExampleConversation(base);
    engine.setMessages((prev) => [...prev, ...seeded.messages]);
    const activeId = activeSessionIdRef.current;
    if (activeId && activeId !== DRAFT_ID) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? { ...s, lastMessageAt: seeded.lastMessageAt }
            : s,
        ),
      );
    }
  }, [engine, setSessions]);

  const refreshSessions = useCallback(async (projectIds?: string[]) => {
    const ids = (projectIds && projectIds.length > 0)
      ? projectIds
      : withChatModuleProjectIds(projectsRef.current.map((p) => p.id));
    if (ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    const lists = await Promise.all(uniqueIds.map((projectId) => window.claude.sessions.list(projectId)));
    const refreshed = lists.flat().map((session) =>
      toChatSession(session, session.id === activeSessionIdRef.current),
    );
    setSessions((prev) => {
      const keep = prev.filter((s) => !uniqueIds.includes(s.projectId));
      const existingById = new Map(prev.map((session) => [session.id, session]));
      const map = new Map<string, ChatSession>();
      [...keep, ...refreshed].forEach((session) => {
        const existing = existingById.get(session.id);
        map.set(session.id, existing
          ? {
              ...session,
              isProcessing: existing.isProcessing,
              hasPendingPermission: existing.hasPendingPermission,
              hasUnreadCompletion: existing.hasUnreadCompletion,
              titleGenerating: existing.titleGenerating,
              // Preserve the delegation link if disk meta hasn't caught up yet
              // (the child's first save may not have flushed before this refresh).
              delegatedFromSessionId: session.delegatedFromSessionId ?? existing.delegatedFromSessionId,
            }
          : session);
      });
      return Array.from(map.values()).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
    });
  }, [setSessions]);

  // ── Derived state ──
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const setCurrentBranch = useCallback((branch: string | undefined) => {
    currentBranchRef.current = branch;
  }, []);

  const completeAcpAuth = useCallback(async (result: ACPAuthenticateResult) => {
    if (!acpSessionId) return;
    const pendingPrompt = pendingAcpDraftPromptRef.current;
    acpAgentSessionIdRef.current = result.agentSessionId ?? acpAgentSessionIdRef.current;
    if (result.configOptions) {
      setInitialConfigOptions(result.configOptions);
      acp.setConfigOptions(result.configOptions);
    }
    if (result.mcpStatuses?.length) {
      const normalizedStatuses = result.mcpStatuses.map((status) => ({
        name: status.name,
        status: toMcpStatusState(status.status),
      }));
      setDraftMcpStatuses(normalizedStatuses);
      setAcpMcpStatuses(normalizedStatuses);
    }

    if (activeSessionIdRef.current === DRAFT_ID && draftProjectIdRef.current) {
      const project = findProject(draftProjectIdRef.current);
      if (project) {
        liveSessionIdsRef.current.add(acpSessionId);
        const now = Date.now();
        const currentBranch = currentBranchRef.current;
        setSessions((prev) => [
          {
            id: acpSessionId,
            projectId: project.id,
            title: "New Chat",
            createdAt: now,
            lastMessageAt: now,
            totalCost: 0,
            requestLog: [],
            planMode: !!startOptionsRef.current.planMode,
            isActive: true,
            titleGenerating: true,
            engine: "acp" as const,
            agentId: startOptionsRef.current.agentId,
            agentSessionId: acpAgentSessionIdRef.current ?? undefined,
            ...(currentBranch ? { branch: currentBranch } : {}),
          },
          ...prev.filter((s) => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })),
        ]);
        setActiveSessionId(acpSessionId);
        setDraftProjectId(null);
        setDraftAcpSessionId(null);
        setAcpMcpStatuses(draftMcpStatusesRef.current.length > 0 ? draftMcpStatusesRef.current : []);
        if (pendingPrompt) {
          generateSessionTitle(acpSessionId, pendingPrompt.text, getProjectCwd(project), "acp");
        }
      }
    }

    acp.clearAuthRequired();

    if (!pendingPrompt) return;
    pendingAcpDraftPromptRef.current = null;
    acp.setIsProcessing(true);
    const promptResult = await window.claude.acp.prompt(acpSessionId, pendingPrompt.text, pendingPrompt.images);
    const promptError = getAcpPromptTransportErrorMessage(promptResult);
    if (promptError && !hasAcpPromptTransportEvent(promptResult)) {
      acp.setMessages((prev) => [
        ...prev,
        createSystemMessage(`ACP prompt error: ${promptError}`, true),
      ]);
      acp.setIsProcessing(false);
    }
  }, [acp, acpSessionId, findProject, generateSessionTitle, getProjectCwd, setAcpMcpStatuses, setDraftAcpSessionId, setDraftMcpStatuses, setDraftProjectId, setInitialConfigOptions, setSessions]);

  const cancelAcpAuth = useCallback(async () => {
    pendingAcpDraftPromptRef.current = null;
    acp.clearAuthRequired();
    acp.setIsProcessing(false);
    if (activeSessionIdRef.current === DRAFT_ID) {
      acp.setMessages([]);
      abandonDraftAcpSession("auth_cancel");
      setSessions((prev) => prev.filter((s) => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));
      setInitialMessages([]);
      setInitialMeta(null);
      setActiveSessionId(null);
      setDraftProjectId(null);
      return;
    }
    if (acpSessionId) {
      suppressNextSessionCompletion(acpSessionId);
      await window.claude.acp.stop(acpSessionId);
    }
  }, [abandonDraftAcpSession, acp, acpSessionId, setActiveSessionId, setDraftProjectId, setInitialMessages, setInitialMeta, setSessions]);

  const loadSplitPaneBootstrap = useCallback(async (sessionId: string): Promise<SessionPaneBootstrap | null> => {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return null;
    }
    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    const cachedConfigOptions = disposition.kind === "runtime"
      ? getAgentCachedConfigOptions(installedAgentsRef.current, disposition.agentId)
      : [];
    let cachedSlashCommands = disposition.kind === "runtime"
      ? getAgentCachedSlashCommands(installedAgentsRef.current, disposition.agentId)
      : [];
    const runtimeAvailable = disposition.kind === "runtime"
      && liveSessionIdsRef.current.has(sessionId);
    if (
      disposition.kind === "runtime"
      && disposition.agentId === BUILTIN_PI_AGENT_ID
      && !runtimeAvailable
    ) {
      const project = findProject(session.projectId);
      if (project) {
        try {
          const catalog = await window.claude.agents.listPiDraftCommands(getProjectCwd(project));
          cachedSlashCommands = catalog.commands;
        } catch {
          // Keep the persisted command cache for this pane.
        }
      }
    }
    const fromBackgroundState = (
      state: NonNullable<ReturnType<BackgroundSessionStore["get"]>>,
    ): SessionPaneBootstrap => ({
      session,
      runtimeAvailable,
      initialMessages: state.messages,
      initialMeta: {
        isProcessing: state.isProcessing,
        isConnected: state.isConnected,
        sessionInfo: state.sessionInfo,
        totalCost: state.totalCost,
        upstreamRequestCount: state.upstreamRequestCount,
        requestLog: state.requestLog ?? [],
        contextUsage: state.contextUsage,
        isCompacting: state.isCompacting,
      },
      initialPermission: state.pendingPermission,
      initialConfigOptions: cachedConfigOptions,
      initialSlashCommands: state.slashCommands?.length
        ? state.slashCommands
        : cachedSlashCommands,
      initialRawAcpPermission: state.rawAcpPermission,
    });
    const claimLatest = (): SessionPaneBootstrap | null => {
      // Multiple hosts can present the same session. Keep the handoff snapshot
      // readable so every host hydrates the same final background state.
      const latest = backgroundStoreRef.current.get(sessionId);
      return latest ? fromBackgroundState(latest) : null;
    };

    const splitPaneState = getSplitPaneStateSnapshot(sessionId);
    if (splitPaneState) {
      return {
        session,
        runtimeAvailable,
        initialMessages: splitPaneState.messages,
        initialMeta: {
          isProcessing: splitPaneState.isProcessing,
          isConnected: splitPaneState.isConnected,
          sessionInfo: splitPaneState.sessionInfo,
          totalCost: splitPaneState.totalCost,
          upstreamRequestCount: splitPaneState.upstreamRequestCount,
          requestLog: splitPaneState.requestLog,
          contextUsage: splitPaneState.contextUsage,
          isCompacting: splitPaneState.isCompacting,
        },
        initialPermission: splitPaneState.pendingPermission,
        initialConfigOptions: splitPaneState.configOptions.length > 0
          ? splitPaneState.configOptions
          : cachedConfigOptions,
        initialSlashCommands: splitPaneState.slashCommands.length > 0
          ? splitPaneState.slashCommands
          : cachedSlashCommands,
        initialRawAcpPermission: splitPaneState.rawAcpPermission,
        claimLatest,
      };
    }

    const backgroundState = backgroundStoreRef.current.get(sessionId);
    if (backgroundState) {
      return { ...fromBackgroundState(backgroundState), claimLatest };
    }

    const persistedSession = await window.claude.sessions.load(session.projectId, sessionId);
    if (!persistedSession) {
      return null;
    }
    const restoredSession = normalizePersistedSessionForDisplay(persistedSession);

    return {
      session,
      runtimeAvailable: false,
      initialMessages: restoredSession.messages,
      initialMeta: {
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: restoredSession.totalCost ?? 0,
        upstreamRequestCount: restoredSession.upstreamRequestCount,
        requestLog: restoredSession.requestLog ?? [],
        contextUsage: restoredSession.contextUsage ?? null,
      },
      initialPermission: null,
      initialConfigOptions: cachedConfigOptions,
      initialSlashCommands: cachedSlashCommands,
      initialRawAcpPermission: null,
      claimLatest,
    };
  }, []);

  // ── Return ──
  return {
    primaryPane,
    sessions,
    setSessions,
    activeSessionId,
    setCurrentBranch,
    activeSession,
    isDraft,
    draftProjectId,
    createSession,
    switchSession,
    deselectSession,
    deleteSession,
    renameSession,
    importCCSession,
    restartActiveSessionInCurrentWorktree,
    setDraftAgent,
    messages: engine.messages,
    isProcessing: engine.isProcessing,
    isConnected: engine.isConnected || isDraft,
    sessionInfo: engine.sessionInfo,
    totalCost: engine.totalCost,
    upstreamRequestCount: engine.upstreamRequestCount,
    requestLog: engine.requestLog,
    send,
    unqueueMessage,
    sendQueuedMessageNext,
    sendNextId,
    seedDevExampleConversation,
    refreshSessions,
    loadSplitPaneBootstrap,
    queuedCount,
    stop: engine.stop,
    interrupt: async () => {
      // Clear queued messages before interrupting
      clearQueue();
      const currentId = activeSessionIdRef.current;
      const currentSession = currentId && currentId !== DRAFT_ID
        ? sessionsRef.current.find((session) => session.id === currentId)
        : undefined;
      if (currentId && currentSession?.source === "wechat") {
        const result = await window.claude.wechat.cancel({ sessionId: currentId });
        if (!result.ok && result.error !== "当前没有正在运行的任务") {
          acp.setMessages((prev) => [
            ...prev,
            createSystemMessage(result.error || "微信 Pi 会话取消失败。", true),
          ]);
        }
        acp.setIsProcessing(false);
        return;
      }
      // During ACP startup (DRAFT + processing), abort the pending start process
      if (activeSessionIdRef.current === DRAFT_ID
          && startOptionsRef.current.engine === "acp"
          && isProcessingRef.current) {
        if (draftAcpSessionIdRef.current && liveSessionIdsRef.current.has(draftAcpSessionIdRef.current)) {
          await window.claude.acp.cancel(draftAcpSessionIdRef.current);
        } else {
          await window.claude.acp.abortPendingStart();
        }
        acp.setIsProcessing(false);
        return;
      }
      await engine.interrupt();
    },
    pendingPermission: engine.pendingPermission,
    respondPermission: engine.respondPermission,
    contextUsage: engine.contextUsage,
    isCompacting: "isCompacting" in engine ? !!engine.isCompacting : false,
    compact: engine.compact,
    // ACP is the only live command source. Legacy command lists are not
    // resurrected from old engine state.
    slashCommands: acp.slashCommands,
    acpConfigOptions: acp.configOptions,
    acpConfigOptionsLoading,
    setACPConfig: acp.setConfig,
    mcpServerStatuses: runtimeEnabled
      ? (acpMcpStatuses.length > 0 ? acpMcpStatuses : draftMcpStatuses)
      : [],
    mcpStatusPreliminary: isDraft && draftMcpStatuses.length > 0 && acpMcpStatuses.length === 0,
    refreshMcpStatus: async () => {
      if (!runtimeEnabled) return;
      const currentId = activeSessionIdRef.current;
      const session = currentId && currentId !== DRAFT_ID
        ? sessionsRef.current.find((entry) => entry.id === currentId)
        : undefined;
      const projectId = session?.projectId ?? draftProjectIdRef.current;
      if (!projectId) return;
      await probeMcpServers(projectId, undefined, startOptionsRef.current);
    },
    reconnectMcpServer: async (_name: string) => {
      if (!runtimeEnabled) return;
      const currentId = activeSessionIdRef.current;
      if (isDraft) {
        if (draftProjectIdRef.current) {
          await probeMcpServers(draftProjectIdRef.current, undefined, startOptionsRef.current);
        }
        return;
      }
      const session = currentId ? sessionsRef.current.find((entry) => entry.id === currentId) : undefined;
      if (!session) return;
      await restartAcpSession(await window.claude.mcp.list());
    },
    restartWithMcpServers: async (servers: McpServerConfig[]) => {
      if (!runtimeEnabled) return;
      if (isDraft) {
        if (draftProjectIdRef.current) {
          await probeMcpServers(draftProjectIdRef.current, servers, startOptionsRef.current);
        }
        return;
      }
      await restartAcpSession(servers);
    },
    acpAuthRequired: runtimeEnabled ? acp.authRequired : false,
    acpAuthMethods: runtimeEnabled ? acp.authMethods : [],
    acpAuthSessionId: runtimeEnabled ? acpSessionId : null,
    acpAuthAgentId: runtimeEnabled
      ? (activeSessionId === DRAFT_ID ? startOptions.agentId ?? null : activeSession?.agentId ?? null)
      : null,
    completeAcpAuth,
    cancelAcpAuth,
  };
}
