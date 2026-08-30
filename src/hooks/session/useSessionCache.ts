import { startTransition, useCallback, useEffect, useRef } from "react";
import type { PersistedSession, Project } from "../../types";
import {
  normalizePersistedSessionForDisplay,
  toChatSession,
} from "../../lib/session/records";
import { withChatModuleProjectIds } from "../../lib/session/chat-module";
import { DRAFT_ID } from "./types";
import type { SharedSessionRefs, SharedSessionSetters } from "./types";
import {
  getAgentCachedConfigOptions,
  getAgentCachedSlashCommands,
} from "@shared/lib/acp-config-cache";
import { getSessionRuntimeDisposition } from "@shared/lib/session-runtime";

const MAX_SESSION_PAYLOAD_CACHE = 6;

interface UseSessionCacheParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  projects: Project[];
  activeSessionId: string | null;
}

export function useSessionCache({
  refs,
  setters,
  projects,
  activeSessionId,
}: UseSessionCacheParams) {
  const {
    setSessions,
    setStartOptions,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setInitialSlashCommands,
    setInitialPermission,
    setInitialRawAcpPermission,
    setAcpConfigOptionsLoading,
    setActiveSessionId,
    setDraftProjectId,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    installedAgentsRef,
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
    const restoredData = normalizePersistedSessionForDisplay(data);
    const disposition = getSessionRuntimeDisposition({
      engine: restoredData.invalidEngine ?? restoredData.engine,
      agentId: restoredData.agentId,
    });
    const restoredAgentId = disposition.kind === "runtime"
      ? disposition.agentId
      : undefined;
    const restoredEngine = disposition.kind === "runtime"
      ? "acp" as const
      : disposition.kind === "legacy-read-only"
        ? disposition.engine
        : undefined;
    const invalidEngine = disposition.kind === "invalid"
      ? disposition.engine
      : restoredData.invalidEngine;
    const restoredConfigOptions = getAgentCachedConfigOptions(
      installedAgentsRef.current,
      restoredAgentId,
    );
    const restoredSlashCommands = getAgentCachedSlashCommands(
      installedAgentsRef.current,
      restoredAgentId,
    );
    startTransition(() => {
      setStartOptions((prev) => ({
        ...prev,
        engine: restoredEngine,
        model: restoredData.model,
        effort: disposition.kind === "runtime" ? undefined : restoredData.effort,
        permissionMode: restoredData.permissionMode,
        planMode: !!restoredData.planMode,
        agentId: restoredAgentId,
        cachedConfigOptions: restoredConfigOptions,
        cachedSlashCommands: restoredSlashCommands,
      }));
      setInitialMessages(restoredData.messages);
      setInitialConfigOptions(restoredConfigOptions);
      setInitialSlashCommands(restoredSlashCommands);
      setAcpConfigOptionsLoading(false);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: restoredData.totalCost,
        upstreamRequestCount: restoredData.upstreamRequestCount,
        requestLog: restoredData.requestLog ?? [],
        contextUsage: restoredData.contextUsage ?? null,
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
            engine: restoredEngine,
            invalidEngine,
            agentId: restoredAgentId,
            ...(restoredData.agentSessionId ? { agentSessionId: restoredData.agentSessionId } : {}),
            ...(restoredData.codexThreadId ? { codexThreadId: restoredData.codexThreadId } : {}),
            ...(restoredData.codexRolloutPath ? { codexRolloutPath: restoredData.codexRolloutPath } : {}),
            ...(restoredData.effort ? { effort: restoredData.effort } : {}),
            ...(restoredData.permissionMode ? { permissionMode: restoredData.permissionMode } : {}),
            planMode: !!restoredData.planMode,
            hasPendingPermission: false,
            hasUnreadCompletion: false,
          } : {}),
        })),
      );
    });
  }, [
    setActiveSessionId,
    setAcpConfigOptionsLoading,
    setDraftProjectId,
    setInitialConfigOptions,
    setInitialMessages,
    setInitialMeta,
    setInitialPermission,
    setInitialRawAcpPermission,
    setInitialSlashCommands,
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
