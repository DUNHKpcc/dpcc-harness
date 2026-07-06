import { startTransition, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { PersistedSession, Project } from "../../types";
import { toChatSession } from "../../lib/session/records";
import { withChatModuleProjectIds } from "../../lib/session/chat-module";
import { toastText } from "../../lib/toast-i18n";
import { DRAFT_ID } from "./types";
import type { SharedSessionRefs, SharedSessionSetters } from "./types";

const MAX_SESSION_PAYLOAD_CACHE = 6;

interface UseSessionCacheParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  projects: Project[];
  activeSessionId: string | null;
  getProjectCwd: (project: Project) => string;
}

export function useSessionCache({
  refs,
  setters,
  projects,
  activeSessionId,
  getProjectCwd,
}: UseSessionCacheParams) {
  const {
    setSessions,
    setStartOptions,
    setInitialMessages,
    setInitialMeta,
    setInitialPermission,
    setInitialRawAcpPermission,
    setActiveSessionId,
    setDraftProjectId,
    setCachedModels,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    backgroundStoreRef,
  } = refs;

  const sessionPayloadCacheRef = useRef<Map<string, PersistedSession>>(new Map());
  const inFlightPrefetchRef = useRef<Set<string>>(new Set());

  // ── LRU payload cache operations ──

  const cacheSessionPayload = useCallback((data: PersistedSession) => {
    const cache = sessionPayloadCacheRef.current;
    cache.delete(data.id);
    cache.set(data.id, data);
    while (cache.size > MAX_SESSION_PAYLOAD_CACHE) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const consumeCachedSessionPayload = useCallback((sessionId: string) => {
    const cache = sessionPayloadCacheRef.current;
    const cached = cache.get(sessionId);
    if (!cached) return null;
    cache.delete(sessionId);
    return cached;
  }, []);

  /** Apply a loaded (or cached) session payload into React state. */
  const applyLoadedSession = useCallback((id: string, data: PersistedSession) => {
    startTransition(() => {
      setStartOptions((prev) => ({
        ...prev,
        engine: data.engine ?? "claude",
        model: data.model,
        effort: data.effort,
        permissionMode: data.permissionMode,
        planMode: !!data.planMode,
        agentId: data.agentId,
      }));
      setInitialMessages(data.messages);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: data.totalCost,
        upstreamRequestCount: data.upstreamRequestCount,
        requestLog: data.requestLog ?? [],
        contextUsage: data.contextUsage ?? null,
      });
      setInitialPermission(null);
      setInitialRawAcpPermission(null);
      setActiveSessionId(id);
      setDraftProjectId(null);
      setSessions((prev) =>
        prev.filter((s) => s.id !== DRAFT_ID).map((s) => ({
          ...s,
          isActive: s.id === id,
          ...(s.id === id ? {
            ...(data.engine ? { engine: data.engine } : {}),
            ...(data.agentId ? { agentId: data.agentId } : {}),
            ...(data.agentSessionId ? { agentSessionId: data.agentSessionId } : {}),
            ...(data.codexThreadId ? { codexThreadId: data.codexThreadId } : {}),
            ...(data.effort ? { effort: data.effort } : {}),
            ...(data.permissionMode ? { permissionMode: data.permissionMode } : {}),
            planMode: !!data.planMode,
            hasPendingPermission: false,
            hasUnreadCompletion: false,
          } : {}),
        })),
      );
    });
  }, [
    setActiveSessionId,
    setDraftProjectId,
    setInitialMessages,
    setInitialMeta,
    setInitialPermission,
    setInitialRawAcpPermission,
    setSessions,
    setStartOptions,
  ]);

  /** Evict a session from the payload cache (e.g. on delete). */
  const evictFromCache = useCallback((sessionId: string) => {
    sessionPayloadCacheRef.current.delete(sessionId);
    inFlightPrefetchRef.current.delete(sessionId);
  }, []);

  // ── Effects ──

  // Load sessions for ALL projects plus the project-independent Chat module.
  useEffect(() => {
    const projectIds = withChatModuleProjectIds(projects.map((project) => project.id));
    Promise.all(
      projectIds.map((projectId) => window.claude.sessions.list(projectId)),
    ).then((results) => {
      const all = results.flat().map((session) => toChatSession(session, false));
      setSessions((prev) => {
        const existingById = new Map(prev.map((session) => [session.id, session]));
        return all.map((session) => {
          const existing = existingById.get(session.id);
          if (!existing) return session;
          return {
            ...session,
            isActive: existing.isActive,
            isProcessing: existing.isProcessing,
            hasPendingPermission: existing.hasPendingPermission,
            hasUnreadCompletion: existing.hasUnreadCompletion,
            titleGenerating: existing.titleGenerating,
          };
        });
      });
    }).catch(() => { /* IPC failure — leave sessions empty */ });
  }, [projects]);

  // Hydrate Claude model cache at app startup and refresh it in the background.
  useEffect(() => {
    let cancelled = false;

    const firstProject = refs.projectsRef.current[0];
    const preferredCwd = firstProject ? getProjectCwd(firstProject) : undefined;

    window.claude.modelsCacheGet().then((result) => {
      if (cancelled) return;
      if (result.models?.length) {
        setCachedModels(result.models);
      }
    }).catch(() => { /* cache read is optional */ });

    // Defer revalidation (spawns a Claude SDK subprocess) to avoid competing with
    // the startup IPC burst. The cached models from modelsCacheGet() above are
    // sufficient for the initial render.
    const revalidateTimer = setTimeout(() => {
      window.claude.modelsCacheRevalidate(preferredCwd ? { cwd: preferredCwd } : undefined).then((result) => {
        if (cancelled) return;
        if (result.models?.length) {
          setCachedModels(result.models);
          return;
        }
        if (result.error) {
          toast.error(toastText("claude.modelsLoadFailed"), { description: result.error });
        }
      }).catch(() => { /* keep stale cache if revalidation fails */ });
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(revalidateTimer);
    };
  }, [getProjectCwd]);

  // Idle-time prefetch of recent session payloads.
  useEffect(() => {
    const candidates = sessionsRef.current
      .filter((session) => session.id !== activeSessionIdRef.current)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
      .slice(0, MAX_SESSION_PAYLOAD_CACHE);

    if (candidates.length === 0) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      for (const session of candidates) {
        if (cancelled) return;
        if (sessionPayloadCacheRef.current.has(session.id)) continue;
        if (inFlightPrefetchRef.current.has(session.id)) continue;
        if (backgroundStoreRef.current.has(session.id)) continue;

        inFlightPrefetchRef.current.add(session.id);
        try {
          const data = await window.claude.sessions.load(session.projectId, session.id);
          if (!cancelled && data) {
            cacheSessionPayload(data);
          }
        } finally {
          inFlightPrefetchRef.current.delete(session.id);
        }
        // Yield between sequential loads to let the main process event loop breathe
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => {
        void run();
      }, { timeout: 5000 });
    } else {
      timerId = setTimeout(() => {
        void run();
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [activeSessionId, cacheSessionPayload, projects]);

  return {
    cacheSessionPayload,
    consumeCachedSessionPayload,
    applyLoadedSession,
    evictFromCache,
  };
}
