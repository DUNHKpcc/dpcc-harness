import type { ToolUseResult } from "./protocol";
import type { EngineId } from "./engine";
import type { ImageAttachment } from "./attachments";
import type { ContextUsage } from "./mcp";
import type { PermissionMode } from "./permissions";

// ── Effort ──

export type ClaudeEffort = "low" | "medium" | "high" | "max";

// ── Session message types ──

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface SubagentToolStep {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: ToolUseResult;
  toolUseId: string;
  toolError?: boolean;
}

interface UIMessageBase {
  id: string;
  content: string;
  timestamp: number;
}

interface ToolBackedMessageFields {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: ToolUseResult;
  toolError?: boolean;
}

interface NoToolBackedMessageFields {
  toolName?: never;
  toolInput?: never;
  toolResult?: never;
  toolError?: never;
}

interface AssistantMessageFields {
  thinking?: string;
  thinkingComplete?: boolean;
  isStreaming?: boolean;
  subagentId?: string;
  subagentSteps?: SubagentToolStep[];
  subagentStatus?: "running" | "completed";
  subagentDurationMs?: number;
  subagentTokens?: number;
  /** SDK checkpoint UUID -- when present, files can be reverted to the state before this message */
  checkpointId?: string;
}

interface NoAssistantMessageFields {
  thinking?: never;
  thinkingComplete?: never;
  isStreaming?: never;
  subagentId?: never;
  subagentSteps?: never;
  subagentStatus?: never;
  subagentDurationMs?: never;
  subagentTokens?: never;
  checkpointId?: never;
}

export type UserUIMessage = UIMessageBase &
  NoToolBackedMessageFields &
  NoAssistantMessageFields & {
    role: "user";
    images?: ImageAttachment[];
    /** User-visible text (with @path refs but without <file> XML blocks). Falls back to regex stripping if absent (old sessions). */
    displayContent?: string;
    /** When true, this user message is waiting in the queue -- not yet sent to the agent */
    isQueued?: boolean;
  };

export type AssistantUIMessage = UIMessageBase &
  NoToolBackedMessageFields &
  AssistantMessageFields & {
    role: "assistant";
  };

export type ToolCallUIMessage = UIMessageBase &
  ToolBackedMessageFields &
  NoAssistantMessageFields & {
    role: "tool_call";
  };

export type ToolResultUIMessage = UIMessageBase &
  ToolBackedMessageFields &
  NoAssistantMessageFields & {
    role: "tool_result";
  };

export type SystemUIMessage = UIMessageBase &
  NoToolBackedMessageFields &
  NoAssistantMessageFields & {
    role: "system";
    /** When true, system message is rendered with error styling (red text, alert icon) */
    isError?: boolean;
  };

export type SummaryUIMessage = UIMessageBase &
  NoToolBackedMessageFields &
  NoAssistantMessageFields & {
    role: "summary";
    compactTrigger?: "manual" | "auto";
    compactPreTokens?: number;
  };

export type UIMessage =
  | UserUIMessage
  | AssistantUIMessage
  | ToolCallUIMessage
  | ToolResultUIMessage
  | SystemUIMessage
  | SummaryUIMessage;

// ── Session metadata ──

export interface SessionInfo {
  sessionId: string;
  model: string;
  cwd: string;
  tools: string[];
  version: string;
  permissionMode?: PermissionMode;
  agentName?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
  icon?: string;
  iconType?: "emoji" | "lucide";
  /**
   * Auto-created by the WeChat bridge to hold its conversations. Hidden from the
   * normal project list (those chats live in the dedicated WeChat area instead).
   */
  wechat?: boolean;
}

/** A user-created folder for organizing chats within a project. */
export interface ChatFolder {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  /** Display order within the project (lower = higher in list). */
  order: number;
  /** Whether this folder is pinned to the top of the sidebar. */
  pinned?: boolean;
}

/** Fields shared between live and persisted session representations. */
export interface SessionBase {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  model?: string;
  effort?: ClaudeEffort;
  permissionMode?: PermissionMode;
  planMode?: boolean;
  totalCost: number;
  engine?: EngineId;
  agentSessionId?: string;
  agentId?: string;
  codexThreadId?: string;
  /** Which folder this chat belongs to (undefined = root level). */
  folderId?: string;
  /** Whether this chat is pinned to the top of the sidebar. */
  pinned?: boolean;
  /** Git branch at session creation time. */
  branch?: string;
  /** Set on a Codex session that was opened by a Claude `codex_delegate` tool call. */
  delegatedFromSessionId?: string;
  /** Origin of the session — undefined = normal desktop UI, "wechat" = WeChat bridge conversation. */
  source?: "wechat";
  /** The originating WeChat `ilink_user_id` when `source === "wechat"`. */
  wechatUserId?: string;
}

export interface ChatSession extends SessionBase {
  /** Timestamp of the most recent message -- used for sidebar sort order */
  lastMessageAt?: number;
  isActive: boolean;
  isProcessing?: boolean;
  /** A background session has a pending permission request (tool approval, etc.) */
  hasPendingPermission?: boolean;
  /** A background session finished while inactive and has not been opened yet. */
  hasUnreadCompletion?: boolean;
  titleGenerating?: boolean;
}

export interface PersistedSession extends SessionBase {
  messages: UIMessage[];
  contextUsage?: ContextUsage | null;
}

export interface CCSessionInfo {
  sessionId: string;
  preview: string;
  model: string;
  timestamp: string;
  fileModified: number;
}
