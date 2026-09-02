import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { PersistedSession, EngineId, ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPTransportErrorEvent } from "@/types";
import { getSessionNotificationActor } from "@/lib/session-notifications";
import { toastText } from "@/lib/toast-i18n";
import { buildPersistedSession, toChatSession } from "../../lib/session/records";
import { normalizeToolInput as acpNormalizeToolInput, pickAutoResponseOption } from "../../lib/engine/acp-adapter";
import { DRAFT_ID } from "./types";
import { createSystemMessage } from "@/lib/message-factory";
import { getPiContextSnapshots } from "@/lib/pi-context-store";
import {
  SESSION_SEND_FAILURE_EVENT,
  type SessionSendFailureDetail,
} from "@/lib/session-send-failure";
import {
  isSplitPaneRoutingReady,
  subscribeSplitPaneState,
  type SplitPaneStateSnapshot,
} from "@/lib/split-pane-state";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";
import {
  getSessionRuntimeDisposition,
  isProtectedBuiltInPiAgent,
} from "@shared/lib/session-runtime";
import { BUILTIN_PI_AGENT, BUILTIN_PI_AGENT_ID } from "@shared/types/registry";

interface UseSessionPersistenceParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  activeSessionId: string | null;
  continueQueuedBackgroundSession?: (sessionId: string) => boolean;
}

export function useSessionPersistence({
  refs,
  setters,
  engines,
  activeSessionId,
  continueQueuedBackgroundSession,
}: UseSessionPersistenceParams) {
  const { acp, engine } = engines;
  const { messages, totalCost, upstreamRequestCount, requestLog, contextUsage, sessionInfo } = engine;
  const {
    setSessions,
    setDraftAcpSessionId,
    setInitialConfigOptions,
    setInitialSlashCommands,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    installedAgentsRef,
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
    liveSessionIdsRef,
    backgroundStoreRef,
    draftAcpSessionIdRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    acpPermissionBehaviorRef,
    saveTimerRef,
  } = refs;
  const metadataSyncSessionRef = useRef<string | null>(null);
  const splitSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const splitPendingSavesRef = useRef(new Map<string, {
    snapshot: SplitPaneStateSnapshot;
    updatedAt: number;
  }>());
  const splitMetadataRef = useRef(new Map<string, {
    model?: string;
    totalCost: number;
    upstreamRequestCount: number;
    requestLog: SplitPaneStateSnapshot["requestLog"];
    lastMessageAt?: number;
    isProcessing: boolean;
    hasPendingPermission: boolean;
  }>());
  const activeSavePendingRef = useRef<{
    sessionId: string;
    updatedAt: number;
  } | null>(null);
  const pendingPersistenceWritesRef = useRef(new Set<Promise<void>>());
  const persistenceGenerationRef = useRef(0);

  const persistRuntimeSession = useCallback((data: PersistedSession) => {
    const disposition = getSessionRuntimeDisposition({
      engine: data.invalidEngine ?? data.engine,
      agentId: data.agentId,
    });
    if (disposition.kind !== "runtime") return Promise.resolve();

    persistenceGenerationRef.current += 1;
    const write = (async () => {
      const agent = installedAgentsRef.current.find((entry) => entry.id === disposition.agentId)
        ?? (disposition.agentId === BUILTIN_PI_AGENT_ID ? BUILTIN_PI_AGENT : undefined);
      const piContextSnapshots = isProtectedBuiltInPiAgent(agent)
        ? getPiContextSnapshots(data.id)
        : [];
      const persistableData = { ...data };
      delete persistableData.piContextSnapshots;
      const result = await window.claude.sessions.save({
        ...persistableData,
        ...(piContextSnapshots.length > 0 ? { piContextSnapshots: [...piContextSnapshots] } : {}),
        engine: disposition.engine,
        agentId: disposition.agentId,
      });
      if (result?.error) throw new Error(result.error);
    })();
    pendingPersistenceWritesRef.current.add(write);
    void write.then(
      () => pendingPersistenceWritesRef.current.delete(write),
      () => pendingPersistenceWritesRef.current.delete(write),
    );
    return write;
  }, []);

  const persistActiveSession = useCallback(async (sessionId: string) => {
    if (activeSessionIdRef.current !== sessionId) return;
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session || messagesRef.current.length === 0) return;
    // Selecting a historical Claude/Codex record must never trigger an
    // automatic migration write. Explicit management actions may still save
    // that record through their own IPC path.
    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    if (disposition.kind !== "runtime") return;

    const messages = messagesRef.current.filter((message) => !message.isQueued);
    const data: PersistedSession = {
      id: sessionId,
      projectId: session.projectId,
      title: session.title,
      createdAt: session.createdAt,
      messages,
      model: session.model || sessionInfoRef.current?.model,
      permissionMode: session.permissionMode,
      planMode: session.planMode,
      totalCost: totalCostRef.current,
      upstreamRequestCount: upstreamRequestCountRef.current,
      requestLog: requestLogRef.current,
      contextUsage: contextUsageRef.current,
      engine: disposition.engine,
      agentId: disposition.agentId,
      ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    };
    await persistRuntimeSession(data);
  }, [persistRuntimeSession]);

  const flushActiveSaveWhenIdle = useCallback(function checkActiveSave() {
    const pending = activeSavePendingRef.current;
    if (!pending) {
      saveTimerRef.current = null;
      return;
    }
    const remaining = 2000 - (Date.now() - pending.updatedAt);
    if (remaining > 0) {
      saveTimerRef.current = setTimeout(checkActiveSave, remaining);
      return;
    }

    activeSavePendingRef.current = null;
    saveTimerRef.current = null;
    void persistActiveSession(pending.sessionId).catch(() => undefined);
  }, [persistActiveSession]);

  const persistSplitSnapshot = useCallback(async (snapshot: SplitPaneStateSnapshot) => {
    const session = sessionsRef.current.find((entry) => entry.id === snapshot.sessionId);
    if (!session || snapshot.messages.length === 0) return;
    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    if (disposition.kind !== "runtime") return;
    const sessionForPersist = snapshot.sessionInfo?.model
      ? { ...session, model: snapshot.sessionInfo.model }
      : session;
    const messages = snapshot.messages.filter((message) => !message.isQueued);
    await persistRuntimeSession(buildPersistedSession(
      sessionForPersist,
      messages,
      snapshot.totalCost,
      snapshot.contextUsage,
      snapshot.requestLog,
      snapshot.upstreamRequestCount,
    ));
  }, [persistRuntimeSession]);

  useEffect(() => {
    const splitSaveDelayMs = 2000;

    const runScheduledSplitSave = (sessionId: string) => {
      const pending = splitPendingSavesRef.current.get(sessionId);
      if (!pending) {
        splitSaveTimersRef.current.delete(sessionId);
        return;
      }
      const remaining = splitSaveDelayMs - (Date.now() - pending.updatedAt);
      if (remaining > 0) {
        splitSaveTimersRef.current.set(
          sessionId,
          setTimeout(() => runScheduledSplitSave(sessionId), remaining),
        );
        return;
      }
      splitSaveTimersRef.current.delete(sessionId);
      splitPendingSavesRef.current.delete(sessionId);
      void persistSplitSnapshot(pending.snapshot).catch(() => undefined);
    };

    const unsubscribe = subscribeSplitPaneState((event) => {
      const { snapshot } = event;

      const lastMessage = snapshot.messages.at(-1);
      const metadata = {
        model: snapshot.sessionInfo?.model,
        totalCost: snapshot.totalCost,
        upstreamRequestCount: snapshot.upstreamRequestCount,
        requestLog: snapshot.requestLog,
        lastMessageAt: lastMessage?.role === "user"
          && typeof lastMessage.timestamp === "number"
          ? lastMessage.timestamp
          : undefined,
        isProcessing: snapshot.isProcessing,
        hasPendingPermission: !!snapshot.pendingPermission,
      };
      const previousMetadata = splitMetadataRef.current.get(snapshot.sessionId);
      const metadataChanged = !previousMetadata
        || previousMetadata.model !== metadata.model
        || previousMetadata.totalCost !== metadata.totalCost
        || previousMetadata.upstreamRequestCount !== metadata.upstreamRequestCount
        || previousMetadata.requestLog !== metadata.requestLog
        || previousMetadata.lastMessageAt !== metadata.lastMessageAt
        || previousMetadata.isProcessing !== metadata.isProcessing
        || previousMetadata.hasPendingPermission !== metadata.hasPendingPermission;
      if (metadataChanged) {
        splitMetadataRef.current.set(snapshot.sessionId, metadata);
        setSessions((prev) => {
          let changed = false;
          const next = prev.map((session) => {
            if (session.id !== snapshot.sessionId) return session;
            const nextModel = metadata.model ?? session.model;
            const nextLastMessageAt = metadata.lastMessageAt ?? session.lastMessageAt;
            if (
              session.model === nextModel
              && session.totalCost === metadata.totalCost
              && session.upstreamRequestCount === metadata.upstreamRequestCount
              && session.requestLog === metadata.requestLog
              && session.lastMessageAt === nextLastMessageAt
              && session.isProcessing === metadata.isProcessing
              && !!session.hasPendingPermission === metadata.hasPendingPermission
            ) {
              return session;
            }
            changed = true;
            return {
              ...session,
              model: nextModel,
              totalCost: metadata.totalCost,
              upstreamRequestCount: metadata.upstreamRequestCount,
              requestLog: metadata.requestLog,
              lastMessageAt: nextLastMessageAt,
              isProcessing: metadata.isProcessing,
              hasPendingPermission: metadata.hasPendingPermission,
            };
          });
          return changed ? next : prev;
        });
      }

      if (event.type === "remove") {
        const timer = splitSaveTimersRef.current.get(snapshot.sessionId);
        if (timer) clearTimeout(timer);
        splitSaveTimersRef.current.delete(snapshot.sessionId);
        splitPendingSavesRef.current.delete(snapshot.sessionId);
        splitMetadataRef.current.delete(snapshot.sessionId);
        backgroundStoreRef.current.initFromState(snapshot.sessionId, {
          messages: snapshot.messages,
          isProcessing: snapshot.isProcessing,
          isConnected: snapshot.isConnected,
          isCompacting: snapshot.isCompacting,
          sessionInfo: snapshot.sessionInfo,
          totalCost: snapshot.totalCost,
          upstreamRequestCount: snapshot.upstreamRequestCount,
          requestLog: snapshot.requestLog,
          contextUsage: snapshot.contextUsage,
          pendingPermission: snapshot.pendingPermission,
          rawAcpPermission: snapshot.rawAcpPermission,
          slashCommands: snapshot.slashCommands,
        });
        void persistSplitSnapshot(snapshot).catch(() => undefined);
        return;
      }

      splitPendingSavesRef.current.set(snapshot.sessionId, {
        snapshot,
        updatedAt: Date.now(),
      });
      persistenceGenerationRef.current += 1;
      if (!splitSaveTimersRef.current.has(snapshot.sessionId)) {
        splitSaveTimersRef.current.set(
          snapshot.sessionId,
          setTimeout(
            () => runScheduledSplitSave(snapshot.sessionId),
            splitSaveDelayMs,
          ),
        );
      }
    });

    return () => {
      unsubscribe();
      for (const timer of splitSaveTimersRef.current.values()) {
        clearTimeout(timer);
      }
      splitSaveTimersRef.current.clear();
      splitPendingSavesRef.current.clear();
      splitMetadataRef.current.clear();
    };
  }, [persistRuntimeSession, setSessions]);

  // Wire up background store callbacks for sidebar indicators
  useEffect(() => {
    backgroundStoreRef.current.onProcessingChange = (sessionId, isProcessing, suppressUnread) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const wasProcessing = !!session?.isProcessing;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                isProcessing,
                // A compaction-only completion must not light up the unread dot.
                ...(isProcessing
                  ? { hasUnreadCompletion: false }
                  : suppressUnread
                    ? {}
                    : { hasUnreadCompletion: true })
              }
            : s,
        ),
      );

      const continuedQueuedSession = wasProcessing && !isProcessing
        ? !!continueQueuedBackgroundSession?.(sessionId)
        : false;

      // A background Pi turn can finish while its child process stays alive.
      // Persist here so its newest context snapshots survive an app restart,
      // rather than waiting for the later process-exit handler.
      if (!isProcessing && liveSessionIdsRef.current.has(sessionId) && session) {
        const state = backgroundStoreRef.current.get(sessionId);
        if (state && state.messages.length > 0) {
          void persistRuntimeSession(buildPersistedSession(
            {
              ...session,
              model: session.model || state.sessionInfo?.model,
            },
            state.messages,
            state.totalCost,
            state.contextUsage,
            state.requestLog ?? [],
            state.upstreamRequestCount,
          )).catch(() => undefined);
        }
      }

      if (wasProcessing && !isProcessing && session && !continuedQueuedSession && !suppressUnread) {
        window.dispatchEvent(new CustomEvent("pcc-agent:background-session-complete", {
          detail: {
            sessionId,
            sessionTitle: session.title,
            actor: getSessionNotificationActor(session),
          },
        }));
      }
    };

    // When a background session receives a permission request, update sidebar + show toast
    backgroundStoreRef.current.onPermissionRequest = (sessionId, permission) => {
      // Update sidebar badge
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, hasPendingPermission: true } : s,
        ),
      );

      // Show a persistent toast so the user notices the blocked session
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const sessionTitle = session?.title ?? toastText("permission.backgroundSession");
      const toolLabel = permission.toolName;

      toast(sessionTitle, {
        id: `permission-${sessionId}`,
        description: toastText("permission.waiting", { tool: toolLabel }),
        duration: Infinity, // Permission is blocking — keep until resolved
        action: {
          label: toastText("permission.switch"),
          onClick: () => switchSessionRef.current?.(sessionId),
        },
      });

      window.dispatchEvent(new CustomEvent("pcc-agent:background-permission-request", {
        detail: {
          sessionId,
          sessionTitle,
          actor: getSessionNotificationActor(session),
          permission,
        },
      }));
    };

    backgroundStoreRef.current.onPermissionCleared = (sessionId) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, hasPendingPermission: false }
            : session,
        ),
      );
      toast.dismiss(`permission-${sessionId}`);
      window.dispatchEvent(new CustomEvent("pcc-agent:background-permission-cleared", {
        detail: { sessionId },
      }));
    };
  }, [
    backgroundStoreRef,
    continueQueuedBackgroundSession,
    persistRuntimeSession,
    sessionsRef,
    setSessions,
    switchSessionRef,
  ]);

  useEffect(() => {
    const handleSendFailure = (event: Event) => {
      const detail = (event as CustomEvent<SessionSendFailureDetail>).detail;
      if (!detail?.sessionId) return;
      if (detail.markDisconnected) {
        liveSessionIdsRef.current.delete(detail.sessionId);
        if (backgroundStoreRef.current.has(detail.sessionId)) {
          backgroundStoreRef.current.markDisconnected(detail.sessionId);
        }
      }
      if (
        detail.sessionId === activeSessionIdRef.current
        || isSplitPaneRoutingReady(detail.sessionId)
      ) {
        return;
      }
      const session = sessionsRef.current.find((entry) => entry.id === detail.sessionId);
      if (!session || !backgroundStoreRef.current.has(detail.sessionId)) return;

      backgroundStoreRef.current.updateMessages(detail.sessionId, (current) => [
        ...current,
        createSystemMessage(detail.message, true),
      ]);
      backgroundStoreRef.current.setProcessing(detail.sessionId, false);

      const state = backgroundStoreRef.current.get(detail.sessionId);
      if (!state) return;
      void persistRuntimeSession(buildPersistedSession(
        {
          ...session,
          model: session.model || state.sessionInfo?.model,
        },
        state.messages,
        state.totalCost,
        state.contextUsage,
        state.requestLog ?? [],
        state.upstreamRequestCount,
      )).catch(() => undefined);
    };
    window.addEventListener(SESSION_SEND_FAILURE_EVENT, handleSendFailure);
    return () => window.removeEventListener(SESSION_SEND_FAILURE_EVENT, handleSendFailure);
  }, [persistRuntimeSession]);

  // Handle exits from the sole live runtime: ACP/Pi.
  useEffect(() => {
    const handleSessionExit = (sid: string) => {
      liveSessionIdsRef.current.delete(sid);

      if (sid === draftAcpSessionIdRef.current) {
        draftAcpSessionIdRef.current = null;
        setDraftAcpSessionId(null);
        setInitialConfigOptions([]);
        setInitialSlashCommands([]);
        backgroundStoreRef.current.delete(sid);
        return;
      }

      // Auto-save and mark disconnected for background sessions
      if (sid !== activeSessionIdRef.current && backgroundStoreRef.current.has(sid)) {
        backgroundStoreRef.current.markDisconnected(sid);
        const bgState = backgroundStoreRef.current.get(sid);
        const session = sessionsRef.current.find((s) => s.id === sid);
        if (bgState && session) {
          const persisted = buildPersistedSession(
            {
              ...session,
              model: session.model || bgState.sessionInfo?.model,
            },
            bgState.messages,
            bgState.totalCost,
            bgState.contextUsage,
            bgState.requestLog ?? [],
            bgState.upstreamRequestCount,
          );
          void persistRuntimeSession(persisted).catch(() => undefined);
        }
      }
    };

    const unsubAcpExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null }) => handleSessionExit(data._sessionId));
    return () => unsubAcpExit();
  }, []);

  // Upsert WeChat-originated sessions into the sidebar as the bridge creates/updates them.
  useEffect(() => {
    const unsub = window.claude.wechat.onEvent((event) => {
      if (event.type !== "session-upsert") return;
      const meta = event.meta;
      setSessions((prev) => {
        const incoming = toChatSession(meta, meta.id === activeSessionIdRef.current);
        const idx = prev.findIndex((s) => s.id === meta.id);
        if (idx === -1) return [...prev, incoming];
        const copy = prev.slice();
        // Refresh persisted fields but preserve renderer-owned transient flags.
        copy[idx] = {
          ...prev[idx],
          title: incoming.title,
          lastMessageAt: incoming.lastMessageAt,
          model: incoming.model ?? prev[idx].model,
          projectId: incoming.projectId,
          source: incoming.source,
          wechatUserId: incoming.wechatUserId,
        };
        return copy;
      });
    });
    return () => unsub();
  }, []);

  // Route non-active ACP events to the background store.
  useEffect(() => {
    const unsubAcp = window.claude.acp.onEvent((event: ACPSessionEvent) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;
      if (isSplitPaneRoutingReady(sid)) return;
      if (sid === draftAcpSessionIdRef.current) return;
      const session = sessionsRef.current.find((entry) => entry.id === sid);
      const disposition = session
        ? getSessionRuntimeDisposition({
            engine: session.invalidEngine ?? session.engine,
            agentId: session.agentId,
          })
        : null;
      const agent = disposition?.kind === "runtime"
        ? installedAgentsRef.current.find((entry) => entry.id === disposition.agentId)
          ?? (disposition.agentId === BUILTIN_PI_AGENT_ID ? BUILTIN_PI_AGENT : undefined)
        : undefined;
      backgroundStoreRef.current.handleACPEvent(event, isProtectedBuiltInPiAgent(agent));
    });

    // Route permission requests for non-active ACP sessions to the background store
    // (auto-respond if the client-side permission behavior allows it)
    const unsubBgAcpPerm = window.claude.acp.onPermissionRequest((data: ACPPermissionEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      if (sid === draftAcpSessionIdRef.current) return;

      // Auto-respond for background ACP sessions when behavior is configured
      const autoOptionId = pickAutoResponseOption(data.options, acpPermissionBehaviorRef.current);
      const preserveManualPermission = () => {
        backgroundStoreRef.current.setPermission(
          sid,
          {
            requestId: data.requestId,
            toolName: data.toolCall.title,
            toolInput: acpNormalizeToolInput(data.toolCall.rawInput, data.toolCall.kind),
            toolUseId: data.toolCall.toolCallId,
          },
          data,
        );
      };
      if (autoOptionId) {
        void window.claude.acp.respondPermission(sid, data.requestId, autoOptionId)
          .then((result) => {
            if (result?.error) preserveManualPermission();
          })
          .catch(() => preserveManualPermission());
        return;
      }

      preserveManualPermission();
    });

    // Route turn-complete for non-active ACP sessions to the background store
    // (clears isProcessing so the session doesn't appear stuck when switching back)
    const unsubBgAcpTurn = window.claude.acp.onTurnComplete((data: ACPTurnCompleteEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      backgroundStoreRef.current.handleACPTurnComplete(sid, data);
    });
    const unsubBgAcpTransportError = window.claude.acp.onTurnTransportError((data: ACPTransportErrorEvent) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      backgroundStoreRef.current.handleACPTransportError(sid, data);
    });

    const unsubBgUpstreamRequest = window.claude.onUpstreamRequest((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      backgroundStoreRef.current.recordUpstreamRequest(sid, event.record, event.countDelta);
    });
    return () => { unsubAcp(); unsubBgAcpPerm(); unsubBgAcpTurn(); unsubBgAcpTransportError(); unsubBgUpstreamRequest(); };
  }, []);

  // Debounced auto-save
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID || messages.length === 0) {
      activeSavePendingRef.current = null;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      return;
    }

    activeSavePendingRef.current = {
      sessionId: activeSessionId,
      updatedAt: Date.now(),
    };
    persistenceGenerationRef.current += 1;
    if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(flushActiveSaveWhenIdle, 2000);
    }
  }, [
    messages,
    activeSessionId,
    sessionInfo?.model,
    upstreamRequestCount,
    requestLog,
    contextUsage,
    flushActiveSaveWhenIdle,
  ]);

  const flushPendingSaves = useCallback(async () => {
    while (true) {
      const observedGeneration = persistenceGenerationRef.current;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const activePending = activeSavePendingRef.current;
      activeSavePendingRef.current = null;

      for (const timer of splitSaveTimersRef.current.values()) {
        clearTimeout(timer);
      }
      splitSaveTimersRef.current.clear();
      const splitPending = [...splitPendingSavesRef.current.values()];
      splitPendingSavesRef.current.clear();

      const flushes: Promise<void>[] = [];
      if (activePending) {
        flushes.push(persistActiveSession(activePending.sessionId));
      }
      for (const pending of splitPending) {
        flushes.push(persistSplitSnapshot(pending.snapshot));
      }
      const results = await Promise.allSettled(flushes);
      const pendingResults = await Promise.allSettled([...pendingPersistenceWritesRef.current]);
      const failure = [...results, ...pendingResults].find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;

      // Allow queued IPC/React work to publish one more generation before ACK.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (
        observedGeneration === persistenceGenerationRef.current
        && !activeSavePendingRef.current
        && splitPendingSavesRef.current.size === 0
        && pendingPersistenceWritesRef.current.size === 0
      ) {
        return;
      }
    }
  }, [persistActiveSession, persistSplitSnapshot]);

  useEffect(() => window.claude.onBeforeClose(flushPendingSaves), [flushPendingSaves]);

  useEffect(() => () => {
    activeSavePendingRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  // Consolidated sync of session metadata to the session list (model, totalCost,
  // lastMessageAt, isProcessing, hasPendingPermission). A single effect avoids
  // multiple separate setSessions(prev => prev.map(...)) calls per render cycle.
  useEffect(() => {
    if (!activeSessionId || activeSessionId === DRAFT_ID) {
      metadataSyncSessionRef.current = null;
      return;
    }
    // Engine hooks reset from their previous session in an effect. Skip the
    // switch render so stale model/cost/request state cannot be written into
    // the newly selected session before that reset has committed.
    if (metadataSyncSessionRef.current !== activeSessionId) {
      metadataSyncSessionRef.current = activeSessionId;
      return;
    }

    // Compute lastMessageAt — only user messages affect sort order
    let lastMessageAt: number | undefined;
    if (messages.length > 0) {
      // On session switch, React state can briefly still hold the previous session's messages.
      // Skip one cycle so we don't stamp the new session with stale activity timestamps.
      if (lastMessageSyncSessionRef.current !== activeSessionId) {
        lastMessageSyncSessionRef.current = activeSessionId;
      } else {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user" && typeof messages[i].timestamp === "number") {
            lastMessageAt = messages[i].timestamp;
            break;
          }
        }
      }
    }

    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== activeSessionId) return s;

        const updates: Record<string, unknown> = {};

        // Model sync
        const nextModel = sessionInfo?.model;
        if (nextModel && s.model !== nextModel) {
          updates.model = nextModel;
        }

        if (sessionInfo?.permissionMode && s.permissionMode !== sessionInfo.permissionMode) {
          updates.permissionMode = sessionInfo.permissionMode;
        }

        // Total cost sync
        if (s.totalCost !== totalCost) {
          updates.totalCost = totalCost;
        }

        if (s.requestLog !== requestLog) {
          updates.requestLog = requestLog;
        }

        if (s.upstreamRequestCount !== upstreamRequestCount) {
          updates.upstreamRequestCount = upstreamRequestCount;
        }

        // lastMessageAt sync
        if (lastMessageAt !== undefined && s.lastMessageAt !== lastMessageAt) {
          updates.lastMessageAt = lastMessageAt;
        }

        // isProcessing sync
        if (s.isProcessing !== engine.isProcessing) {
          updates.isProcessing = engine.isProcessing;
        }

        // hasPendingPermission sync — clear badge when permission is resolved
        if (!engine.pendingPermission && s.hasPendingPermission) {
          updates.hasPendingPermission = false;
        }

        if (Object.keys(updates).length === 0) return s;
        changed = true;
        return { ...s, ...updates };
      });
      return changed ? next : prev;
    });
  }, [activeSessionId, sessionInfo?.model, sessionInfo?.permissionMode, totalCost, upstreamRequestCount, requestLog, messages.length, engine.isProcessing, engine.pendingPermission]);

  // Save current session to disk (used before switching/creating)
  const saveCurrentSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id || id === DRAFT_ID || messagesRef.current.length === 0) return;
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    // Switching away from a historical/invalid record must not turn the
    // display-only snapshot into an implicit migration write. Only a live ACP
    // record is owned by this runtime and may be saved here.
    const disposition = getSessionRuntimeDisposition({
      engine: session.invalidEngine ?? session.engine,
      agentId: session.agentId,
    });
    if (disposition.kind !== "runtime") return;
    // Never persist queued messages — unsent queue state is runtime-only.
    const msgs = messagesRef.current.filter((m) => !m.isQueued);
    const data: PersistedSession = buildPersistedSession(
      session,
      msgs,
      totalCostRef.current,
      contextUsageRef.current,
      requestLogRef.current,
      upstreamRequestCountRef.current,
    );
    await persistRuntimeSession(data);
  }, [persistRuntimeSession]);

  // Seed background store with current active session's state
  const seedBackgroundStore = useCallback(() => {
    const currentId = activeSessionIdRef.current;
    if (currentId && currentId !== DRAFT_ID) {
      const session = sessionsRef.current.find((entry) => entry.id === currentId);
      if (!session || getSessionRuntimeDisposition({
        engine: session.invalidEngine ?? session.engine,
        agentId: session.agentId,
      }).kind !== "runtime") return;
      const slashCommands = acp.slashCommands;

      backgroundStoreRef.current.initFromState(currentId, {
        messages: messagesRef.current,
        isProcessing: isProcessingRef.current,
        isConnected: isConnectedRef.current,
        isCompacting: isCompactingRef.current,
        sessionInfo: sessionInfoRef.current,
        totalCost: totalCostRef.current,
        upstreamRequestCount: upstreamRequestCountRef.current,
        requestLog: requestLogRef.current,
        contextUsage: contextUsageRef.current,
        pendingPermission: pendingPermissionRef.current ?? null,
        rawAcpPermission: null, // ACP ref is internal to useACP — will be restored via initialRawAcpPermission
        slashCommands,
      });
    }
  }, [acp.slashCommands]);

  // AI-generated title via background utility prompt (SDK Haiku or ACP utility session)
  const generateSessionTitle = useCallback(
    async (sessionId: string, message: string, projectPath: string, titleEngine?: EngineId) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, titleGenerating: true } : s,
        ),
      );

      const fallbackTitle =
        message.length > 60 ? message.slice(0, 57) + "..." : message;

      try {
        // Pass engine + sessionId so the IPC handler routes to ACP if needed
        const result = await window.claude.generateTitle(
          message,
          projectPath,
          titleEngine,
          sessionId,
        );

        // Guard: session may have been deleted or manually renamed while generating
        const current = sessionsRef.current.find((s) => s.id === sessionId);
        if (!current || !current.titleGenerating) return;

        const title = result.title || fallbackTitle;

        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, title, titleGenerating: false }
              : s,
          ),
        );

        // Persist the new title
        const data = await window.claude.sessions.load(
          current.projectId,
          sessionId,
        );
        if (data) {
          await persistRuntimeSession({ ...data, title });
        }
      } catch {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, title: fallbackTitle, titleGenerating: false }
              : s,
          ),
        );
      }
    },
    [],
  );

  return {
    saveCurrentSession,
    seedBackgroundStore,
    generateSessionTitle,
  };
}
