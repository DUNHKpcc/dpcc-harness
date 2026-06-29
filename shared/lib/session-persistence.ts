/**
 * Pure session persistence helpers shared between Electron and CLI.
 */

export interface SessionMeta {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  /** Timestamp of the most recent user message — used for sidebar sort order */
  lastMessageAt: number;
  model?: string;
  effort?: string;
  permissionMode?: string;
  planMode?: boolean;
  totalCost?: number;
  upstreamRequestCount?: number;
  requestLog?: unknown[];
  engine?: "claude" | "acp" | "codex";
  codexThreadId?: string;
  /** Which folder this chat belongs to (undefined = root level). */
  folderId?: string;
  /** Whether this chat is pinned to the top of the sidebar. */
  pinned?: boolean;
  /** Git branch at session creation time. */
  branch?: string;
  /** Agent ID — which agent was used for this session. */
  agentId?: string;
  /** Set on a Codex session opened by a Claude `codex_delegate` tool call. */
  delegatedFromSessionId?: string;
  /** Origin of the session — undefined/"desktop" = normal UI, "wechat" = WeChat bridge. */
  source?: "wechat";
  /** The originating WeChat `ilink_user_id` when `source === "wechat"`. */
  wechatUserId?: string;
}

/**
 * Walk messages backward to find the timestamp of the last user message.
 */
export function getLastUserMessageTimestamp(
  messages?: Array<{ role?: string; timestamp?: number }>,
): number | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.timestamp === "number") return msg.timestamp;
  }
  return undefined;
}

/**
 * Extract a SessionMeta from a raw session data object.
 */
export function extractSessionMeta(data: Record<string, unknown>, lastMessageAt: number): SessionMeta {
  return {
    id: data.id as string,
    projectId: data.projectId as string,
    title: (data.title as string) || "Untitled",
    createdAt: (data.createdAt as number) || 0,
    lastMessageAt,
    model: data.model as string | undefined,
    effort: data.effort as string | undefined,
    permissionMode: data.permissionMode as string | undefined,
    planMode: data.planMode as boolean | undefined,
    totalCost: (data.totalCost as number) || 0,
    upstreamRequestCount: typeof data.upstreamRequestCount === "number" ? data.upstreamRequestCount : undefined,
    requestLog: Array.isArray(data.requestLog) ? data.requestLog : [],
    engine: data.engine as SessionMeta["engine"],
    codexThreadId: data.codexThreadId as string | undefined,
    folderId: data.folderId as string | undefined,
    pinned: data.pinned as boolean | undefined,
    branch: data.branch as string | undefined,
    agentId: data.agentId as string | undefined,
    delegatedFromSessionId: data.delegatedFromSessionId as string | undefined,
    source: data.source === "wechat" ? "wechat" : undefined,
    wechatUserId: data.wechatUserId as string | undefined,
  };
}
