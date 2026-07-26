import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { PersistedSession, ClaudeEvent, SystemInitEvent, EngineId, ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent } from "@/types";
import { canonicalizeModelValue } from "@/lib/model-utils";
import { getSessionNotificationActor } from "@/lib/session-notifications";
import { toastText } from "@/lib/toast-i18n";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { buildPersistedSession, toChatSession } from "../../lib/session/records";
import { normalizeToolInput as acpNormalizeToolInput, pickAutoResponseOption } from "../../lib/engine/acp-adapter";
import { DRAFT_ID } from "./types";
import { clearClaudeObservedRequests } from "@/lib/usage/upstream-requests";
import { createSystemMessage } from "@/lib/message-factory";
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
  const { claude, acp, codex, engine } = engines;
  const { messages, totalCost, upstreamRequestCount, requestLog, sessionInfo } = engine;
  const {
    setSessions,
    setDraftMcpStatuses,
    setPreStartedSessionId,
    setDraftAcpSessionId,
    setInitialConfigOptions,
    setInitialSlashCommands,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
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
    preStartedSessionIdRef,
    draftAcpSessionIdRef,
    lastMessageSyncSessionRef,
    switchSessionRef,
    acpPermissionBehaviorRef,
    saveTimerRef,
  } = refs;
  const activeClaudeModels = claude.supportedModels;
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

  // Preserve Codex resume metadata when a transient renderer state omits it.
  const persistSessionWithCodexFallback = useCallback((data: PersistedSession) => {
    persistenceGenerationRef.current += 1;
    const write = (async () => {
      let payload = data;
      if (data.engine === "codex" && (!data.codexThreadId || !data.codexRolloutPath)) {
        try {
          const existing = await window.claude.sessions.load(data.projectId, data.id);
          if (existing) {
            payload = {
              ...data,
              codexThreadId: data.codexThreadId ?? existing.codexThreadId,
              codexRolloutPath: data.codexRolloutPath ?? existing.codexRolloutPath,
            };
          }
        } catch {
          // Best-effort fallback only.
        }
      }
      const result = await window.claude.sessions.save(payload);
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

    const messages = messagesRef.current.filter((message) => !message.isQueued);
    const data: PersistedSession = {
      id: sessionId,
      projectId: session.projectId,
      title: session.title,
      createdAt: session.createdAt,
      messages,
      model: session.model || sessionInfoRef.current?.model,
      effort: session.effort,
      permissionMode: session.permissionMode,
      planMode: session.planMode,
      totalCost: totalCostRef.current,
      upstreamRequestCount: upstreamRequestCountRef.current,
      requestLog: requestLogRef.current,
      contextUsage: contextUsageRef.current,
      engine: session.engine,
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
      ...(session.delegatedFromSessionId ? { delegatedFromSessionId: session.delegatedFromSessionId } : {}),
      ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
      ...(session.engine === "codex" && session.codexRolloutPath ? { codexRolloutPath: session.codexRolloutPath } : {}),
    };
    await persistSessionWithCodexFallback(data);
  }, [persistSessionWithCodexFallback]);

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
    const sessionForPersist = snapshot.sessionInfo?.model
      ? { ...session, model: snapshot.sessionInfo.model }
      : session;
    const messages = snapshot.messages.filter((message) => !message.isQueued);
    await persistSessionWithCodexFallback(buildPersistedSession(
      sessionForPersist,
      messages,
      snapshot.totalCost,
      snapshot.contextUsage,
      snapshot.requestLog,
      snapshot.upstreamRequestCount,
    ));
  }, [persistSessionWithCodexFallback]);

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
  }, [persistSessionWithCodexFallback, setSessions]);

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
  }, [continueQueuedBackgroundSession, sessionsRef, setSessions, switchSessionRef, backgroundStoreRef]);

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
      void persistSessionWithCodexFallback(buildPersistedSession(
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
  }, [persistSessionWithCodexFallback]);

  // Handle session exits across all engines
  useEffect(() => {
    const handleSessionExit = (sid: string) => {
      clearClaudeObservedRequests(sid);
      liveSessionIdsRef.current.delete(sid);

      // If the pre-started eager session crashed, clear it
      if (sid === preStartedSessionIdRef.current) {
        preStartedSessionIdRef.current = null;
        setPreStartedSessionId(null);
        backgroundStoreRef.current.delete(sid);
        return;
      }
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
          void persistSessionWithCodexFallback(persisted).catch(() => undefined);
        }
      }
    };

    const unsubExit = window.claude.onExit((data) => handleSessionExit(data._sessionId));
    const unsubAcpExit = window.claude.acp.onExit((data: { _sessionId: string; code: number | null }) => handleSessionExit(data._sessionId));
    const unsubCodexExit = window.claude.codex.onExit((data) => handleSessionExit(data._sessionId));
    return () => {
      unsubExit();
      unsubAcpExit();
      unsubCodexExit();
    };
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

  // Route events for non-active sessions to the background store
  useEffect(() => {
    const unsub = window.claude.onEvent((event: ClaudeEvent & { _sessionId?: string }) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;
      // Split view: secondary pane's engine hooks handle their own events
      if (isSplitPaneRoutingReady(sid)) return;

      // Pre-started session: route to background store AND extract MCP statuses
      if (sid === preStartedSessionIdRef.current) {
        backgroundStoreRef.current.handleEvent(event);
        if (event.type === "system" && "subtype" in event && event.subtype === "init") {
          const init = event as SystemInitEvent;
          if (init.mcp_servers?.length) {
            setDraftMcpStatuses(init.mcp_servers.map(s => ({
              name: s.name,
              status: toMcpStatusState(s.status),
            })));
          }
        }
        return;
      }

      backgroundStoreRef.current.handleEvent(event);
    });
    const unsubAcp = window.claude.acp.onEvent((event: ACPSessionEvent) => {
      const sid = event._sessionId;
      if (!sid) return;
      if (sid === activeSessionIdRef.current) return;
      if (isSplitPaneRoutingReady(sid)) return;
      if (sid === draftAcpSessionIdRef.current) return;
      backgroundStoreRef.current.handleACPEvent(event);
    });

    // Route permission requests for non-active Claude sessions to the background store
    const unsubBgPerm = window.claude.onPermissionRequest((data) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid) || sid === preStartedSessionIdRef.current) return;
      backgroundStoreRef.current.setPermission(sid, {
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId,
        suggestions: data.suggestions,
        decisionReason: data.decisionReason,
      });
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
      backgroundStoreRef.current.handleACPTurnComplete(sid);
    });

    const unsubBgUpstreamRequest = window.claude.onUpstreamRequest((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      backgroundStoreRef.current.recordUpstreamRequest(sid, event.record, event.countDelta);
    });

    // Route Codex events for non-active sessions to the background store
    const unsubCodex = window.claude.codex.onEvent((event) => {
      const sid = event._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      backgroundStoreRef.current.handleCodexEvent(event);
    });

    // Route Codex approval requests for non-active sessions — auto-decline for now
    const unsubCodexApproval = window.claude.codex.onApprovalRequest((data) => {
      const sid = data._sessionId;
      if (!sid || sid === activeSessionIdRef.current || isSplitPaneRoutingReady(sid)) return;
      if (data.method === "item/tool/requestUserInput") {
        backgroundStoreRef.current.setPermission(sid, {
          requestId: String(data.rpcId),
          toolName: "AskUserQuestion",
          toolInput: {
            source: "codex_request_user_input",
            questions: data.questions.map((question) => ({
              id: question.id,
              header: question.header,
              question: question.question,
              isOther: question.isOther,
              isSecret: question.isSecret,
              options: question.options ?? undefined,
              multiSelect: false,
            })),
          },
          toolUseId: data.itemId,
          codexRpcId: data.rpcId,
        });
        return;
      }

      // Auto-decline background Codex approvals (user must switch to the session)
      backgroundStoreRef.current.setPermission(sid, {
        requestId: String(data.rpcId),
        toolName: data.method.includes("commandExecution") ? "Bash" : "Edit",
        toolInput: {},
        toolUseId: data.itemId,
        codexRpcId: data.rpcId,
      });
    });

    return () => { unsub(); unsubAcp(); unsubBgPerm(); unsubBgAcpPerm(); unsubBgAcpTurn(); unsubBgUpstreamRequest(); unsubCodex(); unsubCodexApproval(); };
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
  }, [messages, activeSessionId, sessionInfo?.model, upstreamRequestCount, requestLog, flushActiveSaveWhenIdle]);

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
        const nextModel = (s.engine ?? "claude") === "claude"
          ? (activeClaudeModels.length > 0
            ? (canonicalizeModelValue(sessionInfo?.model, activeClaudeModels) ?? sessionInfo?.model)
            : s.model)
          : sessionInfo?.model;
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
  }, [activeClaudeModels, activeSessionId, sessionInfo?.model, sessionInfo?.permissionMode, totalCost, upstreamRequestCount, requestLog, messages.length, engine.isProcessing, engine.pendingPermission]);

  // Save current session to disk (used before switching/creating)
  const saveCurrentSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id || id === DRAFT_ID || messagesRef.current.length === 0) return;
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
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
    await persistSessionWithCodexFallback(data);
  }, [persistSessionWithCodexFallback]);

  // Seed background store with current active session's state
  const seedBackgroundStore = useCallback(() => {
    const currentId = activeSessionIdRef.current;
    if (currentId && currentId !== DRAFT_ID) {
      // Pick slash commands from the active engine hook
      const sessionEngine = sessionsRef.current.find(s => s.id === currentId)?.engine ?? "claude";
      const slashCommands = sessionEngine === "codex"
        ? codex.slashCommands
        : sessionEngine === "acp"
          ? acp.slashCommands
          : claude.slashCommands;

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
  }, [claude.slashCommands, acp.slashCommands, codex.slashCommands]);

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
          await persistSessionWithCodexFallback({ ...data, title });
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
    persistSessionWithCodexFallback,
  };
}
