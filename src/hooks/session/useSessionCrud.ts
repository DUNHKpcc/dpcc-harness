import { startTransition, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ChatSession, PersistedSession, Project, ACPConfigOption } from "@/types";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { capture } from "../../lib/analytics/analytics";
import { toastText } from "../../lib/toast-i18n";
import { bgAgentStore } from "../../lib/background/agent-store";
import {
  DRAFT_ID,
  DEFAULT_PERMISSION_MODE,
  getEffectiveClaudePermissionMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, StartOptions } from "./types";

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
  prewarmDraftSession: (projectId: string, options?: StartOptions) => void;
  abandonEagerSession: (reason?: string) => void;
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
  prewarmDraftSession,
  abandonEagerSession,
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

  const clearSessionPlanMode = useCallback((session: ChatSession) => {
    const normalizedPermissionMode = session.permissionMode?.trim() || DEFAULT_PERMISSION_MODE;

    setSessions((prev) => prev.map((entry) => (
      entry.id === session.id && entry.planMode
        ? { ...entry, planMode: false }
        : entry
    )));

    window.claude.sessions.load(session.projectId, session.id).then((data) => {
      if (!data?.planMode) return;
      return window.claude.sessions.save({ ...data, planMode: false });
    }).catch(() => { /* session may have been deleted */ });

    if ((session.engine ?? "claude") !== "claude" || !liveSessionIdsRef.current.has(session.id)) {
      return;
    }

    const effectiveMode = getEffectiveClaudePermissionMode({
      permissionMode: normalizedPermissionMode,
      planMode: false,
    });
    window.claude.setPermissionMode(session.id, effectiveMode).then((result) => {
      if (result?.error) {
        toast.error(toastText("session.planModeUpdateFailed"), { description: result.error });
      }
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(toastText("session.planModeUpdateFailed"), { description: message });
    });
  }, [liveSessionIdsRef, setSessions]);

  // ── Create a new session (draft) ──

  const createSession = useCallback(
    async (projectId: string, options?: StartOptions) => {
      abandonEagerSession("new_draft");
      abandonDraftAcpSession("new_draft");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      setAcpMcpStatuses([]);
      seedBackgroundStore();
      void saveCurrentSession();
      const draftOptions = options ?? {};
      const draftEngine = draftOptions.engine ?? "claude";
      // The eager startup path can resolve before React publishes this draft.
      // Prime the refs first so its target guards see the new session identity.
      startOptionsRef.current = draftOptions;
      draftProjectIdRef.current = projectId;
      activeSessionIdRef.current = DRAFT_ID;
      setStartOptions(draftOptions);
      setDraftProjectId(projectId);
      setInitialMessages([]);
      setInitialMeta(null);
      setInitialConfigOptions(
        draftEngine === "acp" ? (options?.cachedConfigOptions ?? []) : [],
      );
      setInitialSlashCommands([]);
      setAcpConfigOptionsLoading(draftEngine === "acp");
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      // Explicitly clear ACP state — when activeSessionId is already DRAFT_ID,
      // useACP's reset effect won't fire, so stale messages (e.g. from a failed start) would persist
      acp.setMessages([]);
      acp.setIsProcessing(false);
      setActiveSessionId(DRAFT_ID);
      // Remove any leftover pending DRAFT_ID session from a previous failed ACP start
      setSessions((prev) => prev.filter(s => s.id !== DRAFT_ID).map((s) => ({ ...s, isActive: false })));

      prewarmDraftSession(projectId, draftOptions);
    },
    [saveCurrentSession, seedBackgroundStore, abandonEagerSession, abandonDraftAcpSession, prewarmDraftSession],
  );

  // ── Switch to an existing session ──

  const switchSession = useCallback(
    async (id: string) => {
      if (id === activeSessionIdRef.current) return;
      const requestId = ++switchRequestIdRef.current;

      abandonEagerSession("switch_session");
      abandonDraftAcpSession("switch_session");
      acpAgentIdRef.current = null;
      acpAgentSessionIdRef.current = null;
      seedBackgroundStore();
      void saveCurrentSession();

      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      clearSessionPlanMode(session);
      setStartOptions((prev) => ({
        ...prev,
        engine: session.engine ?? "claude",
        model: session.model,
        effort: session.effort,
        permissionMode: session.permissionMode,
        planMode: false,
        agentId: session.agentId,
      }));

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
          setInitialSlashCommands(bgState.slashCommands ?? []);
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
        applyLoadedSession(id, { ...cachedData, planMode: false });
        return;
      }

      // Fall back to loading from disk (non-live session)
      const data = await window.claude.sessions.load(session.projectId, id);
      if (requestId !== switchRequestIdRef.current) return;
      if (data) {
        cacheSessionPayload({ ...data, planMode: false });
        const restored = consumeCachedSessionPayload(id);
        if (restored) {
          applyLoadedSession(id, { ...restored, planMode: false });
        }
      }
    },
    [
      abandonDraftAcpSession,
      abandonEagerSession,
      applyLoadedSession,
      cacheSessionPayload,
      consumeCachedSessionPayload,
      saveCurrentSession,
      seedBackgroundStore,
      setActiveSessionId,
      setDraftProjectId,
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
          if (session.engine === "codex") {
            await window.claude.codex.stop(id);
          } else if (session.engine === "acp") {
            await window.claude.acp.stop(id);
          } else {
            await window.claude.stop(id, "session_delete");
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
    abandonEagerSession("deselect");
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
  }, [saveCurrentSession, seedBackgroundStore, abandonEagerSession, abandonDraftAcpSession]);

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

  const setDraftAgent = useCallback((draftEngine: string, agentId: string, cachedConfigOptions?: ACPConfigOption[], model?: string) => {
    const prevEngine = startOptionsRef.current.engine ?? "claude";
    const prevAgentId = startOptionsRef.current.agentId;
    const normalizedModel = typeof model === "string" ? model.trim() : "";
    const engineChanged = prevEngine !== draftEngine;
    const agentChanged = prevAgentId !== agentId;
    const modelChanged = (startOptionsRef.current.model ?? "") !== normalizedModel;
    const targetChanged = engineChanged || agentChanged || modelChanged;
    if (targetChanged) {
      ++draftGenerationRef.current;
    }
    if (engineChanged) {
      capture("engine_switched", { from_engine: prevEngine, to_engine: draftEngine });
    }

    if (prevEngine === "claude" && (draftEngine !== "claude" || agentChanged || modelChanged)) {
      // Changing a Claude draft's target invalidates its eager session too.
      abandonEagerSession("engine_switch");
    }
    if (prevEngine === "acp" && (draftEngine !== "acp" || agentChanged)) {
      abandonDraftAcpSession("engine_switch");
    }

    const shouldPrewarm = engineChanged
      || (draftEngine === "claude" && (agentChanged || modelChanged))
      || (draftEngine === "acp" && agentChanged);
    const shouldResetCommands = engineChanged
      || (draftEngine !== "codex" && shouldPrewarm);
    if (shouldResetCommands) {
      setInitialSlashCommands([]);
    }

    const nextOptions: StartOptions = {
      ...startOptionsRef.current,
      engine: draftEngine as StartOptions["engine"],
      agentId,
      model: normalizedModel || undefined,
    };
    // Keep async prewarm guards aligned before React publishes the new draft.
    startOptionsRef.current = nextOptions;
    setStartOptions(nextOptions);

    if (!shouldPrewarm || !draftProjectIdRef.current) return;
    if (draftEngine === "acp") {
      setInitialConfigOptions(cachedConfigOptions ?? []);
    }
    prewarmDraftSession(draftProjectIdRef.current, nextOptions);
  }, [abandonEagerSession, abandonDraftAcpSession, prewarmDraftSession]);

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
