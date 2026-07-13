/**
 * useEngineBase — shared foundation for all engine hooks (useClaude, useACP, useCodex).
 *
 * Provides the 8 common state variables, reset effect on sessionId change,
 * and rAF-based streaming flush scheduling. Each engine hook calls this
 * and adds only its engine-specific event handling and IPC calls.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UIMessage, SessionInfo, PermissionRequest, ContextUsage, BackgroundSessionSnapshot, UpstreamRequestRecord, UpstreamRequestEvent } from "@/types";
import { getUpstreamRequestCount, trimUpstreamRequestLog, upsertUpstreamRequestRecord } from "@/lib/usage/upstream-requests";

export interface UseEngineBaseOptions {
  sessionId: string | null;
  initialMessages?: UIMessage[];
  initialMeta?: BackgroundSessionSnapshot | null;
  initialPermission?: PermissionRequest | null;
}

export interface EngineBaseState {
  // State
  messages: UIMessage[];
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  totalCost: number;
  setTotalCost: Dispatch<SetStateAction<number>>;
  upstreamRequestCount: number;
  setUpstreamRequestCount: Dispatch<SetStateAction<number>>;
  requestLog: UpstreamRequestRecord[];
  setRequestLog: Dispatch<SetStateAction<UpstreamRequestRecord[]>>;
  recordUpstreamRequest: (record: UpstreamRequestRecord, countDelta?: number) => void;
  pendingPermission: PermissionRequest | null;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  contextUsage: ContextUsage | null;
  setContextUsage: Dispatch<SetStateAction<ContextUsage | null>>;
  isCompacting: boolean;
  setIsCompacting: Dispatch<SetStateAction<boolean>>;

  // Refs
  sessionIdRef: React.RefObject<string | null>;
  messagesRef: React.RefObject<UIMessage[]>;
  upstreamRequestCountRef: React.RefObject<number>;
  requestLogRef: React.RefObject<UpstreamRequestRecord[]>;

  // rAF scheduling — engine hooks call scheduleFlush after pushing data to their buffer
  pendingFlush: React.RefObject<boolean>;
  rafId: React.RefObject<number>;
  scheduleFlush: (flushFn: () => void) => void;
  cancelPendingFlush: () => void;
}

export function useEngineBase({
  sessionId,
  initialMessages,
  initialMeta,
  initialPermission,
}: UseEngineBaseOptions): EngineBaseState {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [isProcessing, setIsProcessing] = useState(initialMeta?.isProcessing ?? false);
  const [isConnected, setIsConnected] = useState(initialMeta?.isConnected ?? false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(initialMeta?.sessionInfo ?? null);
  const [totalCost, setTotalCost] = useState(initialMeta?.totalCost ?? 0);
  const [requestLog, setRequestLog] = useState<UpstreamRequestRecord[]>(
    trimUpstreamRequestLog(initialMeta?.requestLog),
  );
  const [upstreamRequestCount, setUpstreamRequestCount] = useState(
    getUpstreamRequestCount(initialMeta?.requestLog, initialMeta?.upstreamRequestCount),
  );
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(initialPermission ?? null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(initialMeta?.contextUsage ?? null);
  const [isCompacting, setIsCompacting] = useState(initialMeta?.isCompacting ?? false);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const requestLogRef = useRef(requestLog);
  requestLogRef.current = requestLog;
  const upstreamRequestCountRef = useRef(upstreamRequestCount);
  upstreamRequestCountRef.current = upstreamRequestCount;
  const requestStateSessionIdRef = useRef(sessionId);
  if (requestStateSessionIdRef.current !== sessionId) {
    requestStateSessionIdRef.current = sessionId;
    requestLogRef.current = trimUpstreamRequestLog(initialMeta?.requestLog);
    upstreamRequestCountRef.current = getUpstreamRequestCount(
      initialMeta?.requestLog,
      initialMeta?.upstreamRequestCount,
    );
  }
  const messagesRef = useRef<UIMessage[]>(messages);
  messagesRef.current = messages;

  // rAF scheduling refs
  const pendingFlush = useRef(false);
  const rafId = useRef(0);

  // Reset state when sessionId changes, restoring background state if available
  useEffect(() => {
    // Cancel any pending rAF flush from the previous session to prevent stale
    // streaming data from overwriting the new session's messages.
    cancelAnimationFrame(rafId.current);
    pendingFlush.current = false;

    setMessages(initialMessages ?? []);
    if (initialMeta) {
      setIsProcessing(initialMeta.isProcessing);
      setIsConnected(initialMeta.isConnected);
      setSessionInfo(initialMeta.sessionInfo);
      setTotalCost(initialMeta.totalCost);
      setRequestLog(requestLogRef.current);
      setUpstreamRequestCount(upstreamRequestCountRef.current);
      setContextUsage(initialMeta.contextUsage);
    } else {
      setIsProcessing(false);
      setIsConnected(false);
      setSessionInfo(null);
      setTotalCost(0);
      setRequestLog(requestLogRef.current);
      setUpstreamRequestCount(upstreamRequestCountRef.current);
      setContextUsage(null);
    }
    setPendingPermission(initialPermission ?? null);
    setIsCompacting(initialMeta?.isCompacting ?? false);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared rAF scheduling — engines provide their own flush function
  const scheduleFlush = useCallback((flushFn: () => void) => {
    if (pendingFlush.current) return;
    pendingFlush.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingFlush.current = false;
      flushFn();
    });
  }, []);

  const cancelPendingFlush = useCallback(() => {
    if (pendingFlush.current) {
      cancelAnimationFrame(rafId.current);
      pendingFlush.current = false;
    }
  }, []);

  const recordUpstreamRequest = useCallback((record: UpstreamRequestRecord, countDelta?: number) => {
    const merged = upsertUpstreamRequestRecord(requestLogRef.current, record);
    requestLogRef.current = merged.requestLog;
    setRequestLog(merged.requestLog);
    const increment = countDelta ?? (merged.inserted ? Math.max(1, record.requestCount || 1) : 0);
    if (increment > 0) {
      const nextCount = upstreamRequestCountRef.current + increment;
      upstreamRequestCountRef.current = nextCount;
      setUpstreamRequestCount(nextCount);
    }
  }, []);

  useEffect(() => window.claude.onUpstreamRequest((event: UpstreamRequestEvent) => {
    if (event._sessionId !== sessionIdRef.current) return;
    recordUpstreamRequest(event.record, event.countDelta);
  }), [recordUpstreamRequest]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (pendingFlush.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  return {
    messages, setMessages,
    isProcessing, setIsProcessing,
    isConnected, setIsConnected,
    sessionInfo, setSessionInfo,
    totalCost, setTotalCost,
    upstreamRequestCount, setUpstreamRequestCount,
    requestLog, setRequestLog, recordUpstreamRequest,
    pendingPermission, setPendingPermission,
    contextUsage, setContextUsage,
    isCompacting, setIsCompacting,
    sessionIdRef,
    messagesRef,
    upstreamRequestCountRef,
    requestLogRef,
    pendingFlush,
    rafId,
    scheduleFlush,
    cancelPendingFlush,
  };
}
