import type { SessionMeta as SessionListItem } from "@shared/lib/session-persistence";
import type { ChatSession, ClaudeEffort, ContextUsage, PersistedSession, UIMessage, UpstreamRequestRecord } from "@/types";
import { getUpstreamRequestCount, trimUpstreamRequestLog } from "@/lib/usage/upstream-requests";
import { normalizeInterruptedSession } from "@shared/lib/session-recovery";

const VALID_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
function toClaudeEffort(value: string | undefined): ClaudeEffort | undefined {
  return value && VALID_EFFORTS.has(value) ? (value as ClaudeEffort) : undefined;
}

export function toChatSession(
  session: SessionListItem,
  isActive: boolean,
): ChatSession {
  const requestLog = Array.isArray(session.requestLog)
    ? trimUpstreamRequestLog(session.requestLog as UpstreamRequestRecord[])
    : [];
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt || session.createdAt,
    model: session.model,
    effort: toClaudeEffort(session.effort),
    permissionMode: session.permissionMode,
    planMode: session.planMode,
    totalCost: session.totalCost ?? 0,
    upstreamRequestCount: getUpstreamRequestCount(requestLog, session.upstreamRequestCount),
    requestLog,
    isActive,
    engine: session.engine,
    invalidEngine: session.invalidEngine,
    codexThreadId: session.codexThreadId,
    codexRolloutPath: session.codexRolloutPath,
    folderId: session.folderId,
    pinned: session.pinned,
    branch: session.branch,
    agentId: session.agentId,
    agentSessionId: session.agentSessionId,
    delegatedFromSessionId: session.delegatedFromSessionId,
    source: session.source,
    wechatUserId: session.wechatUserId,
  };
}

export function buildPersistedSession(
  session: ChatSession,
  messages: UIMessage[],
  totalCost: number,
  contextUsage: ContextUsage | null,
  requestLog?: UpstreamRequestRecord[],
  upstreamRequestCount?: number,
): PersistedSession {
  const recentRequestLog = trimUpstreamRequestLog(requestLog ?? session.requestLog);
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    messages,
    model: session.model,
    ...(session.engine !== "acp" && session.effort ? { effort: session.effort } : {}),
    permissionMode: session.permissionMode,
    planMode: session.planMode,
    totalCost,
    upstreamRequestCount: getUpstreamRequestCount(recentRequestLog, upstreamRequestCount ?? session.upstreamRequestCount),
    requestLog: recentRequestLog,
    contextUsage,
    engine: session.engine,
    invalidEngine: session.invalidEngine,
    folderId: session.folderId,
    pinned: session.pinned,
    branch: session.branch,
    ...(session.agentId ? { agentId: session.agentId } : {}),
    ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    // New Pi sessions are first-class ACP sessions, not Claude-to-Codex
    // delegation children. Preserve this legacy field only when re-saving an
    // old non-ACP record for compatibility.
    ...(session.engine !== "acp" && session.delegatedFromSessionId
      ? { delegatedFromSessionId: session.delegatedFromSessionId }
      : {}),
    ...(session.engine === "codex" && session.codexThreadId ? { codexThreadId: session.codexThreadId } : {}),
    ...(session.engine === "codex" && session.codexRolloutPath ? { codexRolloutPath: session.codexRolloutPath } : {}),
    ...(session.source ? { source: session.source } : {}),
    ...(session.wechatUserId ? { wechatUserId: session.wechatUserId } : {}),
  };
}

export function normalizePersistedSessionForDisplay(
  session: PersistedSession,
): PersistedSession {
  return normalizeInterruptedSession(session);
}
