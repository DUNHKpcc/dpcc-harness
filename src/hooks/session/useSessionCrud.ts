import { startTransition, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ChatSession, PersistedSession, Project, ACPConfigOption, SlashCommand } from "@/types";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { capture } from "../../lib/analytics/analytics";
import { toastText } from "../../lib/toast-i18n";
import { bgAgentStore } from "../../lib/background/agent-store";
import {
  DRAFT_ID,
  DEFAULT_PERMISSION_MODE,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";
import {
  getSessionRuntimeDisposition,
  normalizeNewSessionIdentity,
} from "@shared/lib/session-runtime";
import {
  getAgentCachedConfigOptions,
  getAgentCachedSlashCommands,
  normalizeCachedAcpConfigOptions,
  normalizeCachedAcpSlashCommands,
} from "@shared/lib/acp-config-cache";

interface UseSessionCrudParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
  // From persistence
  saveCurrentSession: () => Promise<void>;
  seedBackgroundStore: () => void;
  // From draft materialization
  abandonDraftAcpSession: (reason?: string) => void;
  // From session cache
  cacheSessionPayload: (data: PersistedSession) => void;
  consumeCachedSessionPayload: (sessionId: string) => PersistedSession | null;
  applyLoadedSession: (id: string, data: PersistedSession) => void;
  evictFromCache: (sessionId: string) => void;
  // From message queue
  clearQueue: () => void;
}

export function applySelectedSessionReadState(session: ChatSession, selectedSessionId: string): ChatSession {
  if (session.id !== selectedSessionId) {
    return { ...session, isActive: false };
  }
  return {
    ...session,
    isActive: true,
    hasPendingPermission: false,
    hasUnreadCompletion: false,
  };
}

export function useSessionCrud({
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
}: UseSessionCrudParams) {
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
    setStartOptions,
    setDraftProjectId,
    setAcpConfigOptionsLoading,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    installedAgentsRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    draftProjectIdRef,
    startOptionsRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
    messageQueueRef,
    switchSessionRef,
    onSpaceChangeRef,
    draftGenerationRef,
    saveTimerRef,
  } = refs;

  const switchRequestIdRef = useRef(0);

  // ── Create a new session (draft) ──

  const createSession = useCallback(
    async (projectId: string, options?: StartOptions) => {
      abandonDraftAcpSession("new_draft");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      setAcpMcpStatuses([]);
      seedBackgroundStore();
      void saveCurrentSession();
      const requestedOptions = options ?? {};
      const identity = normalizeNewSessionIdentity(requestedOptions);
      const installedAgent = installedAgentsRef.current.find((agent) => (
        agent.engine === "acp" && agent.id === identity.agentId
      ));
      const registryConfigOptions = installedAgent
        ? getAgentCachedConfigOptions(installedAgentsRef.current, identity.agentId)
        : [];
      const registrySlashCommands = installedAgent
        ? getAgentCachedSlashCommands(installedAgentsRef.current, identity.agentId)
        : [];
      const cachedConfigOptions = registryConfigOptions.length > 0
        ? registryConfigOptions
        : normalizeCachedAcpConfigOptions(requestedOptions.cachedConfigOptions);
      const cachedSlashCommands = registrySlashCommands.length > 0
        ? registrySlashCommands
        : normalizeCachedAcpSlashCommands(requestedOptions.cachedSlashCommands);
      const draftOptions: StartOptions = {
        ...requestedOptions,
        engine: identity.engine,
        agentId: identity.agentId,
        effort: undefined,
        cachedConfigOptions,
        cachedSlashCommands,
      };
      const draftEngine = identity.engine;
      // Publish the logical draft immediately. No ACP process exists until send.
      startOptionsRef.current = draftOptions;
      draftProjectIdRef.current = projectId;
      activeSessionIdRef.current = DRAFT_ID;
      setStartOptions(draftOptions);
      setDraftProjectId(projectId);
      setInitialMessages([]);
      setInitialMeta(null);
      setInitialConfigOptions(
        draftEngine === "acp" ? cachedConfigOptions : [],
      );
      setInitialSlashCommands(
        draftEngine === "acp" ? cachedSlashCommands : [],
      );
      setAcpConfigOptionsLoading(false);
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      // Explicitly clear ACP state — when activeSessionId is already DRAFT_ID,
      // useACP's reset effect won't fire, so stale messages (e.g. from a failed start) would persist
      acp.setMessages([]);
      acp.setIsProcessing(false);
      setActiveSessionId(DRAFT_ID);
      // Remove any leftover pending DRAFT_ID session from a previous failed ACP start
      setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));

    },
    [saveCurrentSession, seedBackgroundStore, abandonDraftAcpSession],
  );

  // ── Switch to an existing session ──

  const switchSession = useCallback(
    async (id: string) => {
      if (id === activeSessionIdRef.current) return;
      const requestId = ++switchRequestIdRef.current;

      abandonDraftAcpSession("switch_session");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      seedBackgroundStore();
      void saveCurrentSession();

      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      const disposition = getSessionRuntimeDisposition({
        engine: session.invalidEngine ?? session.engine,
        agentId: session.agentId,
      });
      const nextEngine = disposition.kind === "runtime"
        ? "acp"
        : disposition.kind === "legacy-read-only"
          ? disposition.engine
          // `StartOptions.engine` cannot encode an unknown persisted value.
          // Use the sole runtime enum only as a neutral display value; the
          // disposition guard keeps this record detached and read-only.
          : "acp";
      const cachedConfigOptions = disposition.kind === "runtime"
        ? getAgentCachedConfigOptions(installedAgentsRef.current, disposition.agentId)
        : [];
      const cachedSlashCommands = disposition.kind === "runtime"
        ? getAgentCachedSlashCommands(installedAgentsRef.current, disposition.agentId)
        : [];
      setStartOptions((prev) => ({
        ...prev,
        engine: nextEngine,
        model: session.model,
        effort: disposition.kind === "runtime" ? undefined : session.effort,
        permissionMode: session.permissionMode,
        planMode: !!session.planMode,
        agentId: disposition.kind === "runtime" ? disposition.agentId : undefined,
        cachedConfigOptions,
        cachedSlashCommands,
      }));
      setInitialConfigOptions(cachedConfigOptions);
      setInitialSlashCommands(cachedSlashCommands);
      setAcpConfigOptionsLoading(false);

      // Switch to the correct space for this session's project — ensures that
      // clicking a permission toast (or any cross-space navigation) lands in the right space
      const sessionProject = refs.projectsRef.current.find((p) => p.id === session.projectId);
      if (sessionProject) {
        onSpaceChangeRef.current?.(sessionProject.spaceId || "default");
      }

      // Restore from the in-memory session cache if available.
      const bgState = backgroundStoreRef.current.consume(id);
      if (bgState) {
        const normalizedBgSessionInfo = bgState.sessionInfo?.permissionMode === "plan"
          ? {
              ...bgState.sessionInfo,
              permissionMode: session.permissionMode?.trim() || DEFAULT_PERMISSION_MODE,
            }
          : bgState.sessionInfo;
        startTransition(() => {
          setInitialMessages(bgState.messages);
          setInitialMeta({
            isProcessing: bgState.isProcessing,
            isConnected: bgState.isConnected,
            sessionInfo: normalizedBgSessionInfo,
            totalCost: bgState.totalCost,
            upstreamRequestCount: bgState.upstreamRequestCount,
            requestLog: bgState.requestLog ?? [],
            contextUsage: bgState.contextUsage,
            isCompacting: bgState.isCompacting,
          });
          setInitialPermission(bgState.pendingPermission);
          setInitialRawAcpPermission(bgState.rawAcpPermission);
          setInitialSlashCommands(
            bgState.slashCommands?.length ? bgState.slashCommands : cachedSlashCommands,
          );
          setActiveSessionId(id);
          setDraftProjectId(null);
          setSessions((prev) =>
            prev.filter(s => s.id !== DRAFT_ID).map((s) => applySelectedSessionReadState(s, id)),
          );
        });
        toast.dismiss(`permission-${id}`);
        return;
      }

      const cachedData = consumeCachedSessionPayload(id);
      if (cachedData) {
        applyLoadedSession(id, cachedData);
        return;
      }

      // Fall back to loading from disk (non-live session)
      const data = await window.claude.sessions.load(session.projectId, id);
      if (requestId !== switchRequestIdRef.current) return;
      if (data) {
        cacheSessionPayload(data);
        const restored = consumeCachedSessionPayload(id);
        if (restored) {
          applyLoadedSession(id, restored);
        }
      }
    },
    [
      abandonDraftAcpSession,
      applyLoadedSession,
      cacheSessionPayload,
      consumeCachedSessionPayload,
      saveCurrentSession,
      seedBackgroundStore,
      setActiveSessionId,
      setDraftProjectId,
      setAcpConfigOptionsLoading,
      setInitialConfigOptions,
      setInitialMessages,
      setInitialMeta,
      setInitialPermission,
      setInitialRawAcpPermission,
      setInitialSlashCommands,
      setSessions,
      setStartOptions,
    ],
  );

  // Keep switchSessionRef in sync for stable toast callbacks
  switchSessionRef.current = switchSession;

  // ── Delete a session ──

  const deleteSession = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      if (id === DRAFT_ID) {
        ++draftGenerationRef.current;
      }
      evictFromCache(id);
      // Remove renderer ownership before the first await. This prevents the
      // active 2s auto-save from observing the session while deletion is in
      // progress. The main process also tombstones the ID for queued saves.
      if (activeSessionIdRef.current === id) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        clearQueue();
        setActiveSessionId(null);
        setInitialMessages([]);
        setInitialMeta(null);
        setInitialPermission(null);
        setInitialRawAcpPermission(null);
      }
      setSessions((prev) => prev.filter((entry) => entry.id !== id));
      const deleteFromDisk = window.claude.sessions.delete(session.projectId, id);

      if (liveSessionIdsRef.current.has(id)) {
        suppressNextSessionCompletion(id);
        try {
          if (session.engine === "acp") {
            await window.claude.acp.stop(id);
          }
        } catch (err) {
          console.warn("[deleteSession] Failed to stop live transport:", err);
        }
        liveSessionIdsRef.current.delete(id);
      }
      backgroundStoreRef.current.delete(id);
      messageQueueRef.current.delete(id);
      bgAgentStore.clearSession(id);
      void window.claude.notifications.dismissSession(id);
      // Dismiss any permission toast for this session
      toast.dismiss(`permission-${id}`);
      try {
        const deleteResult = await deleteFromDisk;
        if (deleteResult?.error) {
          setSessions((prev) => prev.some((entry) => entry.id === id)
            ? prev
            : [{ ...session, isActive: false, isProcessing: false }, ...prev]);
          toast.error(toastText("session.deleteFailed"), {
            description: deleteResult.error,
          });
        }
      } catch (err) {
        setSessions((prev) => prev.some((entry) => entry.id === id)
          ? prev
          : [{ ...session, isActive: false, isProcessing: false }, ...prev]);
        toast.error(toastText("session.deleteFailed"), {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [clearQueue, evictFromCache],
  );

  // ── Rename a session ──

  const renameSession = useCallback((id: string, title: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, titleGenerating: false } : s)),
    );
    window.claude.sessions.load(session.projectId, id).then((data) => {
      if (data) {
        window.claude.sessions.save({ ...data, title });
      }
    }).catch(() => { /* session may have been deleted */ });
  }, []);

  // ── Deselect the active session ──

  const deselectSession = useCallback(async () => {
    abandonDraftAcpSession("deselect");
    seedBackgroundStore();
    void saveCurrentSession();
    setActiveSessionId(null);
    setDraftProjectId(null);
    setInitialMessages([]);
    setInitialMeta(null);
    setInitialPermission(null);
    setInitialRawAcpPermission(null);
    // Filter out any leftover DRAFT_ID placeholder from a pending ACP start
    setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));
  }, [saveCurrentSession, seedBackgroundStore, abandonDraftAcpSession]);

  // ── Import a Claude Code session ──

  const importCCSession = useCallback(
    async (projectId: string, ccSessionId: string) => {
      ++draftGenerationRef.current;
      const project = findProject(projectId);
      if (!project) return;

      // If already imported, just switch to it
      const existing = sessionsRef.current.find((s) => s.id === ccSessionId);
      if (existing) {
        await switchSession(ccSessionId);
        return;
      }

      seedBackgroundStore();
      void saveCurrentSession();

      const result = await window.claude.ccSessions.import(getProjectCwd(project), ccSessionId);
      if (result.error || !result.messages) return;

      const firstUserMsg = result.messages.find((m) => m.role === "user");
      const titleText = firstUserMsg?.content || "Imported Session";

      const newSession: ChatSession = {
        id: ccSessionId,
        projectId: project.id,
        title: titleText.length > 60 ? titleText.slice(0, 57) + "..." : titleText,
        createdAt: result.messages[0]?.timestamp || Date.now(),
        totalCost: 0,
        requestLog: [],
        isActive: true,
      };

      // Persist immediately so switchSession can load it later
      const saveResult = await window.claude.sessions.save({
        id: ccSessionId,
        projectId: project.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        messages: result.messages,
        totalCost: 0,
        requestLog: [],
      }, { restoreDeleted: true });
      if (saveResult?.error) {
        toast.error(toastText("session.importFailed"), { description: saveResult.error });
        return;
      }
      cacheSessionPayload({
        id: ccSessionId,
        projectId: project.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        messages: result.messages,
        totalCost: 0,
        requestLog: [],
      });

      setSessions((prev) => [
        newSession,
        ...prev.map((s) => ({ ...s, isActive: false })),
      ]);
      setInitialMessages(result.messages);
      setInitialMeta(null);
      setActiveSessionId(ccSessionId);
      setDraftProjectId(null);
      capture("session_imported", { message_count: result.messages.length });
    },
    [cacheSessionPayload, findProject, saveCurrentSession, seedBackgroundStore, switchSession],
  );

  // ── Switch draft engine/agent ──

  const setDraftAgent = useCallback((
    draftEngine: string,
    agentId: string,
    cachedConfigOptions?: ACPConfigOption[],
    model?: string,
    cachedSlashCommands?: SlashCommand[],
  ) => {
    const prevEngine = startOptionsRef.current.engine ?? "acp";
    const identity = normalizeNewSessionIdentity({ engine: draftEngine, agentId });
    const normalizedEngine = identity.engine;
    const normalizedAgentId = identity.agentId;
    const prevAgentId = startOptionsRef.current.agentId;
    const normalizedModel = typeof model === "string" ? model.trim() : "";
    const engineChanged = prevEngine !== normalizedEngine;
    const agentChanged = prevAgentId !== normalizedAgentId;
    const modelChanged = (startOptionsRef.current.model ?? "") !== normalizedModel;
    const targetChanged = engineChanged || agentChanged || modelChanged;
    if (targetChanged) {
      ++draftGenerationRef.current;
    }
    if (engineChanged) {
      capture("engine_switched", { from_engine: prevEngine, to_engine: normalizedEngine });
    }

    if (prevEngine === "acp" && (normalizedEngine !== "acp" || agentChanged)) {
      abandonDraftAcpSession("engine_switch");
    }

    const shouldRefreshCache = engineChanged || agentChanged || modelChanged;
    const shouldResetCommands = engineChanged || shouldRefreshCache;
    if (shouldResetCommands) {
      setInitialSlashCommands([]);
    }

    const nextOptions: StartOptions = {
      ...startOptionsRef.current,
      engine: normalizedEngine,
      agentId: normalizedAgentId,
      model: normalizedModel || undefined,
      effort: undefined,
      cachedConfigOptions,
      cachedSlashCommands,
    };
    // Keep the first-send snapshot aligned before React publishes the draft.
    startOptionsRef.current = nextOptions;
    setStartOptions(nextOptions);

    if (!shouldRefreshCache || !draftProjectIdRef.current) return;
    if (normalizedEngine === "acp") {
      setInitialConfigOptions(cachedConfigOptions ?? []);
      setInitialSlashCommands(cachedSlashCommands ?? []);
      setAcpConfigOptionsLoading(false);
    }
  }, [abandonDraftAcpSession]);

  return {
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    deselectSession,
    importCCSession,
    setDraftAgent,
  };
}
