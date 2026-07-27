/**
 * Settings types shared between electron and renderer processes.
 *
 * Canonical definitions — import from here, never redefine.
 */

// ── Simple scalar types ──

export type PreferredEditor = "auto" | "cursor" | "code" | "zed";
export type VoiceDictationMode = "native" | "whisper";
export const TERMINAL_SHELLS = [
  "auto",
  "pwsh",
  "powershell",
  "cmd",
  "git-bash",
  "wsl",
  "zsh",
  "bash",
  "fish",
  "custom",
] as const;
export type TerminalShell = (typeof TERMINAL_SHELLS)[number];
export interface TerminalShellOption {
  shell: Exclude<TerminalShell, "custom">;
  available: boolean;
  path?: string;
}
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ThemeOption = "light" | "dark" | "system";
/** UI language. "system" follows the OS locale (zh-* → Chinese, otherwise English). */
export type LanguageOption = "system" | "en" | "zh";
export type MacBackgroundEffect = "liquid-glass" | "vibrancy" | "off";
export type CodexBinarySource = "builtin" | "auto" | "managed" | "custom";
export type ClaudeBinarySource = "builtin" | "auto" | "managed" | "custom";
/** Where the auto-updater fetches releases from. "github" = official source, "mirror" = self-hosted domestic mirror. */
export type UpdateSource = "github" | "mirror";
/** Which upstream source a built-in Claude Code or Codex session should use. */
export type CliConfigSource = "default" | "local" | "gateway";
/** Explicit local account choice. "unset" means onboarding has not chosen yet. */
export type AccountMode = "unset" | "guest";

// ── Notification settings ──

export type NotificationTrigger = "always" | "unfocused" | "never";

export interface NotificationEventSettings {
  osNotification: NotificationTrigger;
  sound: NotificationTrigger;
}

export interface NotificationSettings {
  exitPlanMode: NotificationEventSettings;
  permissions: NotificationEventSettings;
  askUserQuestion: NotificationEventSettings;
  sessionComplete: NotificationEventSettings;
}

// ── Custom gateway settings ──

export interface GatewayModelMapping {
  /** User-facing name shown in gateway pickers. */
  displayName: string;
  /** Upstream model id sent to the gateway. */
  modelId: string;
}

/** Third-party gateway config for the Claude engine (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN). */
export interface ClaudeGatewaySettings {
  /** Engine settings toggle for this saved gateway; routing is selected by the Claude config source. */
  enabled: boolean;
  /** Gateway endpoint → ANTHROPIC_BASE_URL */
  baseUrl: string;
  /** Bearer token / API key → ANTHROPIC_AUTH_TOKEN */
  authToken: string;
  /** Custom model id used as the session default when the Claude config source is "gateway" (empty = upstream default). */
  model: string;
  /** Editable display-name → upstream-model mappings for gateway model pickers. */
  modelMappings: GatewayModelMapping[];
}

/** Third-party gateway config for the Codex engine (model_providers override). */
export interface CodexGatewaySettings {
  /** Engine settings toggle for this saved provider; routing is selected by the Codex config source. */
  enabled: boolean;
  /** Human-readable provider display name */
  name: string;
  /** Provider endpoint → model_providers.<id>.base_url */
  baseUrl: string;
  /** API key injected into the app-server process under the provider's env_key */
  apiKey: string;
  /** Custom model id used as the session default when the Codex config source is "gateway". */
  model: string;
  /** Editable display-name → upstream-model mappings for gateway model pickers. */
  modelMappings: GatewayModelMapping[];
}

/**
 * DPCC official default upstream (origin-api.dpccgaming.xyz). Applied when Current
 * Config source is "default". Credentials come from the
 * DPCC API account entry (Settings → Account) and the welcome wizard. Unlike the
 * gateway settings there is no `enabled` flag — this is the default upstream,
 * gated only by whether a token is present.
 */
export interface DpccUpstreamSettings {
  /** Host root (empty → DEFAULT_NEWAPI_BASE_URL). Claude uses as-is; Codex appends /v1. */
  baseUrl: string;
  /** @deprecated Legacy migration input only. Renderer IPC always returns an empty string. */
  claudeToken: string;
  /** @deprecated Legacy migration input only. Renderer IPC always returns an empty string. */
  codexToken: string;
  /** Optional Claude default model id (empty = keep the picker) */
  claudeModel: string;
  /** Optional Codex default model id (empty = keep the picker) */
  codexModel: string;
}

// ── Main AppSettings interface ──

/** Main-process app settings (persisted to JSON file in data dir). */
export interface AppSettings {
  /** Include pre-release versions when checking for updates */
  allowPrereleaseUpdates: boolean;
  /**
   * Which feed the auto-updater pulls from. "github" is the official CI-published
   * source; "mirror" points at the self-hosted domestic mirror (URL is a build-time
   * constant in updater.ts). Default "github".
   */
  updateSource: UpdateSource;
  /** Number of recent chats to show per project in the sidebar (default: 10) */
  defaultChatLimit: number;
  /** Preferred code editor for "Open in Editor" actions (default: "auto") */
  preferredEditor: PreferredEditor;
  /** Voice dictation mode: "native" uses OS dictation, "whisper" uses local AI model (default: "native") */
  voiceDictation: VoiceDictationMode;
  /** Shell used for newly created integrated terminals */
  terminalShell: TerminalShell;
  /** Absolute executable path used when terminalShell is "custom" */
  terminalCustomShellPath: string;
  /** Last non-maximized main-window bounds */
  windowBounds: WindowBounds | null;
  /** Whether the main window was maximized when its state was last saved */
  windowMaximized: boolean;
  /** Per-event notification and sound configuration */
  notifications: NotificationSettings;
  /** Custom client name sent to Codex servers during handshake (default: "PccAgent") */
  codexClientName: string;
  /** Which Codex binary source to use */
  codexBinarySource: CodexBinarySource;
  /** Absolute path used when codexBinarySource is custom */
  codexCustomBinaryPath: string;
  /** Which Claude binary source to use */
  claudeBinarySource: ClaudeBinarySource;
  /** Absolute path used when claudeBinarySource is custom */
  claudeCustomBinaryPath: string;
  /** One-time marker that legacy binary source defaults were normalized to built-in */
  binarySourceDefaultsMigrated: boolean;
  /** Show developer-only "Dev Fill" button in chat title bar (local dev builds only) */
  showDevFillInChatTitleBar: boolean;
  /** Show the Jira board UI in the sidebar and main panel (developer preview) */
  showJiraBoard: boolean;
  /** Preferred native macOS background material when window transparency is enabled */
  macBackgroundEffect: MacBackgroundEffect;
  /** Saved third-party gateway config for the Claude engine */
  claudeGateway: ClaudeGatewaySettings;
  /** Saved third-party gateway config for the Codex engine */
  codexGateway: CodexGatewaySettings;
  /** Legacy shared upstream source. Kept for migration/backward compatibility. */
  cliConfigSource: CliConfigSource;
  /** Selected upstream source for built-in Claude Code sessions. */
  claudeCliConfigSource: CliConfigSource;
  /** Selected upstream source for built-in Codex sessions. */
  codexCliConfigSource: CliConfigSource;
  /** Non-sensitive DPCC account choice used to distinguish Guest from dismissal. */
  accountMode: AccountMode;
  /**
   * DPCC official default upstream metadata. Credentials are stored separately
   * by the Electron main process in strict OS-backed storage.
   */
  dpccUpstream: DpccUpstreamSettings;
  /**
   * @deprecated Legacy migration input only. Renderer IPC always returns an
   * empty string and cannot write this field.
   */
  accountAccessToken: string;
  /**
   * @deprecated Legacy migration input only.
   */
  accountUserId: string;
}
