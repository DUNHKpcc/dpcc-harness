import type { ChatSession, UIMessage, SessionInfo, PermissionRequest, FileReference, ImageAttachment, McpServerStatus, AcpPermissionBehavior, EngineId, Project, SlashCommand, ClaudeEffort, ContextUsage, ACPConfigOption, ACPPermissionEvent, UpstreamRequestRecord, InstalledAgent } from "@/types";
import type { BackgroundSessionStore } from "../../lib/background/session-store";

export const DRAFT_ID = "__draft__";
export const DEFAULT_PERMISSION_MODE = "default";

export interface StartOptions {
  model?: string;
  permissionMode?: string;
  planMode?: boolean;
  effort?: ClaudeEffort;
  cwd?: string;
  engine?: EngineId;
  agentId?: string;
  /** Cached config options from previous sessions */
  cachedConfigOptions?: ACPConfigOption[];
  /** Cached ACP slash commands available before the runtime starts. */
  cachedSlashCommands?: SlashCommand[];
}

export interface InitialMeta {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  upstreamRequestCount?: number;
  requestLog?: UpstreamRequestRecord[];
  contextUsage: ContextUsage | null;
  isCompacting?: boolean;
}

export interface QueuedMessage {
  text: string;
  images?: ImageAttachment[];
  displayText?: string;
  fileReferences?: FileReference[];
  /** ID of the UIMessage already shown in chat with isQueued: true */
  messageId: string;
}

export interface PendingAcpDraftPrompt {
  text: string;
  images?: ImageAttachment[];
  displayText?: string;
  fileReferences?: FileReference[];
}

export interface MaterializedDraftSession {
  sessionId: string;
  engine: EngineId;
  model?: string;
  planMode: boolean;
}

export interface SessionPaneBootstrap {
  session: ChatSession;
  runtimeAvailable: boolean;
  usesPiContextBridge: boolean;
  initialMessages: UIMessage[];
  initialMeta: InitialMeta | null;
  initialPermission: PermissionRequest | null;
  initialConfigOptions: ACPConfigOption[];
  initialSlashCommands: SlashCommand[];
  initialRawAcpPermission: ACPPermissionEvent | null;
  claimLatest?: () => SessionPaneBootstrap | null;
}

/** Shared refs that multiple sub-hooks need to read/write */
export interface SharedSessionRefs {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  installedAgentsRef: React.MutableRefObject<readonly InstalledAgent[]>;
  projectsRef: React.MutableRefObject<Project[]>;
  draftProjectIdRef: React.MutableRefObject<string | null>;
  startOptionsRef: React.MutableRefObject<StartOptions>;
  messagesRef: React.MutableRefObject<UIMessage[]>;
  totalCostRef: React.MutableRefObject<number>;
  upstreamRequestCountRef: React.MutableRefObject<number>;
  requestLogRef: React.MutableRefObject<UpstreamRequestRecord[]>;
  contextUsageRef: React.MutableRefObject<ContextUsage | null>;
  isProcessingRef: React.MutableRefObject<boolean>;
  isCompactingRef: React.MutableRefObject<boolean>;
  isConnectedRef: React.MutableRefObject<boolean>;
  sessionInfoRef: React.MutableRefObject<SessionInfo | null>;
  pendingPermissionRef: React.MutableRefObject<PermissionRequest | null>;
  acpConfigOptionsRef: React.MutableRefObject<ACPConfigOption[]>;
  liveSessionIdsRef: React.MutableRefObject<Set<string>>;
  backgroundStoreRef: React.MutableRefObject<BackgroundSessionStore>;
  draftAcpSessionIdRef: React.MutableRefObject<string | null>;
  draftMcpStatusesRef: React.MutableRefObject<McpServerStatus[]>;
  materializingRef: React.MutableRefObject<boolean>;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  messageQueueRef: React.MutableRefObject<Map<string, QueuedMessage[]>>;
  pendingAcpDraftPromptRef: React.MutableRefObject<PendingAcpDraftPrompt | null>;
  acpAgentIdRef: React.MutableRefObject<string | null>;
  acpAgentSessionIdRef: React.MutableRefObject<string | null>;
  lastMessageSyncSessionRef: React.MutableRefObject<string | null>;
  switchSessionRef: React.MutableRefObject<((id: string) => Promise<void>) | undefined>;
  onSpaceChangeRef: React.MutableRefObject<((spaceId: string) => void) | undefined>;
  acpPermissionBehaviorRef: React.MutableRefObject<AcpPermissionBehavior>;
  /** Current git branch for the active project — set by the orchestrator. */
  currentBranchRef: React.MutableRefObject<string | undefined>;
  draftGenerationRef: React.MutableRefObject<number>;
}

/** State setters from the orchestrator that sub-hooks need */
export interface SharedSessionSetters {
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setInitialMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setInitialMeta: React.Dispatch<React.SetStateAction<InitialMeta | null>>;
  setInitialConfigOptions: React.Dispatch<React.SetStateAction<ACPConfigOption[]>>;
  setInitialSlashCommands: React.Dispatch<React.SetStateAction<SlashCommand[]>>;
  setInitialPermission: React.Dispatch<React.SetStateAction<PermissionRequest | null>>;
  setInitialRawAcpPermission: React.Dispatch<React.SetStateAction<ACPPermissionEvent | null>>;
  setStartOptions: React.Dispatch<React.SetStateAction<StartOptions>>;
  setDraftProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftAcpSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setAcpConfigOptionsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftMcpStatuses: React.Dispatch<React.SetStateAction<McpServerStatus[]>>;
  setAcpMcpStatuses: React.Dispatch<React.SetStateAction<McpServerStatus[]>>;
  setQueuedCount: React.Dispatch<React.SetStateAction<number>>;
}

// Engine hook types — use ReturnType of the actual hooks for perfect alignment.
// Imported via type-only to avoid circular dependency (hooks import types, not vice versa).
import type { useACP } from "../useACP";

/** The only live engine hook. Legacy records are rendered through this state
 * but are never connected to a removed runtime. */
export interface EngineHooks {
  acp: ReturnType<typeof useACP>;
  engine: ReturnType<typeof useACP>;
}

// ── Utility functions shared across sub-hooks ──
