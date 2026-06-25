// ── Protocol types (Claude CLI stream-json wire format) ──

export type {
  SystemInitEvent,
  SystemStatusEvent,
  SystemCompactBoundaryEvent,
  StreamEvent,
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  AssistantMessageEvent,
  AssistantMessageUsage,
  ContentBlock,
  ToolResultEvent,
  ToolUseResult,
  ResultEvent,
  ResultSuccessEvent,
  ResultErrorEvent,
  ResultErrorSubtype,
  ModelUsageEntry,
  TaskStartedEvent,
  TaskProgressEvent,
  TaskNotificationEvent,
  ToolProgressEvent,
  ClaudeEvent,
  AuthStatusEvent,
} from "./protocol";

// ── Session types ──

export type {
  ClaudeEffort,
  TodoItem,
  SubagentToolStep,
  UserUIMessage,
  AssistantUIMessage,
  ToolCallUIMessage,
  ToolResultUIMessage,
  SystemUIMessage,
  SummaryUIMessage,
  UIMessage,
  SessionInfo,
  Project,
  ChatFolder,
  SessionBase,
  ChatSession,
  PersistedSession,
  CCSessionInfo,
} from "./session";

// ── Space types ──

export type {
  SpaceColor,
  Space,
} from "./spaces";

// ── Search types ──

export type {
  SearchMessageResult,
  SearchSessionResult,
} from "./search";

// ── Attachment types ──

export type {
  FileReference,
  ImageAttachment,
  FileAttachment,
  GrabbedElement,
} from "./attachments";

// ── Permission types ──

export type {
  PermissionMode,
  PermissionUpdateDestination,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionRequest,
  AcpPermissionBehavior,
} from "./permissions";

// ── Background agent types ──

export type {
  BackgroundAgentUsage,
  BackgroundAgent,
  BackgroundAgentActivity,
} from "./agents";

// ── MCP & model types ──

export type {
  ContextUsage,
  ModelInfo,
  McpTransport,
  McpServerConfig,
  McpServerStatusState,
  McpServerStatus,
} from "./mcp";

// ── Settings types (shared) ──

export type {
  PreferredEditor,
  VoiceDictationMode,
  ThemeOption,
  LanguageOption,
  MacBackgroundEffect,
  CodexBinarySource,
  ClaudeBinarySource,
  UpdateSource,
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
  ClaudeGatewaySettings,
  CodexGatewaySettings,
} from "@shared/types/settings";

// ── WeChat bridge types (shared) ──

export type {
  WeChatTool,
  WeChatPermissionMode,
  WeChatBridgeConfig,
  WeChatConnectionStatus,
  WeChatBridgeState,
  WeChatLoginStatus,
  WeChatBridgeEvent,
} from "@shared/types/wechat";

// ── Git types (shared) ──

export type {
  GitFileStatus,
  GitFileGroup,
  GitFileChange,
  GitBranch,
  GitRepoInfo,
  GitStatus,
  GitLogEntry,
} from "@shared/types/git";

// ── Registry types ──

export type {
  InstalledAgent,
  RegistryAgent,
  RegistryData,
  RegistryDistribution,
  RegistryNpxDistribution,
  RegistryBinaryTarget,
  BinaryCheckResult,
} from "./registry";

// ── ACP types ──

export type {
  ACPSessionEvent,
  ACPSessionUpdate,
  ACPAgentMessageChunk,
  ACPAgentThoughtChunk,
  ACPUserMessageChunk,
  ACPToolCall,
  ACPToolCallUpdate,
  ACPPlan,
  ACPUsageUpdate,
  ACPSessionInfoUpdate,
  ACPCurrentModeUpdate,
  ACPConfigOptionUpdate,
  ACPPermissionEvent,
  ACPTurnCompleteEvent,
  ACPConfigOption,
  ACPConfigSelectOption,
  ACPConfigSelectGroup,
  ACPAvailableCommand,
  ACPAvailableCommandsUpdate,
  ACPAuthEnvVar,
  ACPAuthMethodAgent,
  ACPAuthMethodEnvVar,
  ACPAuthMethodTerminal,
  ACPAuthMethod,
  ACPStatusInfo,
  ACPStartSuccessResult,
  ACPStartAuthRequiredResult,
  ACPStartErrorResult,
  ACPStartResult,
  ACPAuthenticateResult,
} from "./acp";

// ── Engine types ──

export type { EngineId, EngineHookState, AppPermissionBehavior, RespondPermissionFn, BackgroundSessionSnapshot, SlashCommand } from "./engine";

// ── Codex types ──

export type {
  CodexSessionEvent,
  CodexApprovalRequest,
  CodexRequestUserInputRequest,
  CodexServerRequest,
  CodexExitEvent,
  CodexAuthRequiredNotification,
  CodexTokenUsageNotification,
  CodexThreadItem,
  CodexItemStartedNotification,
  CodexItemCompletedNotification,
  CodexAgentMessageDeltaNotification,
  CodexCommandOutputDeltaNotification,
  CodexPlanDeltaNotification,
  CodexTurnPlanUpdatedNotification,
  CodexReasoningTextDeltaNotification,
  CodexFileUpdateChange,
  CodexPatchChangeKind,
  CodexTurnPlanStep,
  CodexUserInput,
  CodexWebSearchAction,
} from "./codex";

// ── Tool types ──

export type { ToolId, PanelToolId, ToolDef } from "./tools";

// ── Tool islands types ──

export type {
  ToolIslandDock,
  ToolIsland,
  ToolColumn,
  TopRowItem,
  ToolIslandMemory,
  ToolDragState,
  PaneResizeController,
  TopColumnLocation,
} from "./tool-islands";

// ── Pane controller types ──

export type {
  PaneController,
  ToolIslandContextProps,
} from "./pane-controller";
