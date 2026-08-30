import type { CCSessionInfo, ChatFolder, PersistedSession, Project, UIMessage, UpstreamRequestEvent } from "./session";
import type { Space } from "./spaces";
import type { SearchMessageResult, SearchSessionResult } from "./search";
import type { McpServerConfig } from "./mcp";
import type { GitRepoInfo, GitStatus, GitBranch, GitLogEntry } from "@shared/types/git";
import type { InstalledAgent, PiRuntimeStatus } from "@shared/types/registry";
import type { EffectiveCliConfig, EffectiveCliModels } from "@shared/types/cc-config";
import type { AppSettings, MacBackgroundEffect, ThemeOption } from "@shared/types/settings";
import type {
  AppNotificationBridge,
} from "@shared/types/notifications";
import type { WeChatBridgeState, WeChatBridgeConfig, WeChatBridgeEvent } from "@shared/types/wechat";
import type { AccountConfig, AccountBalanceResult, AccountModelsResult, AccountOverview, AccountStatus, UsageStats, UsageStatsResult } from "@shared/types/account";
import type { AccountAuthActionResult, AccountAuthSnapshot } from "@shared/types/account-auth";
import type {
  CatalogResult,
  InstalledMcpRecord,
  InstalledSkillRecord,
  McpCatalogInstallRequest,
  McpCatalogInstallResult,
  McpCatalogItem,
  SkillCatalogItem,
  SkillInstallRequest,
} from "@shared/types/plugins";
import type {
  ACPSessionEvent,
  ACPPermissionEvent,
  ACPTurnCompleteEvent,
  ACPTransportErrorEvent,
  ACPConfigOption,
  ACPAuthenticateResult,
  ACPAvailableCommand,
  ACPAuthMethod,
  ACPStartResult,
  ACPStatusInfo,
  ACPPromptResult,
  ACPReviveResult,
} from "./acp";
import type { EngineId, SlashCommand } from "./engine";
import type { SessionMeta as SessionListItem } from "@shared/lib/session-persistence";
import type {
  JiraProjectConfig,
  JiraBoard,
  JiraIssue,
  JiraSprint,
  JiraComment,
  JiraTransition,
  JiraBoardConfiguration,
  JiraProjectSummary,
  JiraGetBoardsParams,
  JiraGetIssuesParams,
  JiraGetSprintsParams,
  JiraGetCommentsParams,
  JiraGetTransitionsParams,
  JiraTransitionIssueParams,
} from "@shared/types/jira";

/** Standard IPC result envelope — most IPC calls return this shape. */
interface IpcResult {
  ok?: boolean;
  error?: string;
}

interface FileWatchChangeEvent {
  cwd: string;
  paths?: string[];
  hasStructuralChange?: boolean;
}

declare global {
  /** Result of the GitHub pre-release check for the running version. */
  interface PreReleaseInfo {
    isPreRelease: boolean;
    version: string;
    releaseUrl: string | null;
  }

  interface Window {
    claude: {
      /** OS UI language injected by the main process (e.g. "zh-CN", "en-US"); "" if unavailable. Used by the "system" i18n option. */
      systemLocale: string;
      getGlassSupported: () => Promise<boolean>;
      getMacBackgroundEffectSupport: () => Promise<{ liquidGlass: boolean; vibrancy: boolean }>;
      setThemeSource: (themeSource: ThemeOption) => void;
      setMacBackgroundEffect: (effect: MacBackgroundEffect) => void;
      relaunchApp: () => Promise<IpcResult>;
      setMinWidth: (width: number) => void;
      onBeforeClose: (callback: () => Promise<void> | void) => () => void;
      onTrayOpenSession: (
        callback: (target: { projectId: string; sessionId: string }) => void,
      ) => () => void;
      windowActivationReady: () => void;
      menuBar: {
        onNewChatRequested: (callback: () => void) => () => void;
        onOpenSettingsRequested: (callback: () => void) => () => void;
      };
      notifications: AppNotificationBridge;
      glass: {
        setTintColor: (tintColor: string | null) => void;
        setTheme: (theme: "light" | "dark" | "system") => void;
      };
      readFile: (filePath: string) => Promise<{ content?: string; error?: string }>;
      getDroppedFilePath: (file: File) => string;
      renameFile: (oldPath: string, newPath: string) => Promise<IpcResult>;
      trashItem: (filePath: string) => Promise<IpcResult>;
      newFile: (filePath: string) => Promise<IpcResult>;
      newFolder: (folderPath: string) => Promise<IpcResult>;
      writeClipboardText: (text: string) => Promise<IpcResult>;
      setBrowserColorScheme: (
        targetWebContentsId: number,
        colorScheme: "light" | "dark",
      ) => Promise<IpcResult>;
      openInEditor: (filePath: string, line?: number, editor?: string) => Promise<IpcResult & { editor?: string }>;
      openExternal: (url: string) => Promise<IpcResult>;
      showItemInFolder: (filePath: string) => Promise<IpcResult>;
      generateTitle: (
        message: string,
        cwd?: string,
        engine?: EngineId,
        sessionId?: string,
      ) => Promise<{ title?: string; error?: string }>;
      onUpstreamRequest: (callback: (event: UpstreamRequestEvent) => void) => () => void;
      projects: {
        list: () => Promise<Project[]>;
        create: (spaceId?: string) => Promise<Project | null>;
        createDev: (name: string, spaceId?: string) => Promise<Project | null>;
        delete: (projectId: string) => Promise<IpcResult>;
        rename: (projectId: string, name: string) => Promise<IpcResult>;
        updateSpace: (projectId: string, spaceId: string) => Promise<IpcResult>;
        updateIcon: (projectId: string, icon: string | null, iconType: "emoji" | "lucide" | null) => Promise<IpcResult>;
        reorder: (projectId: string, targetProjectId: string) => Promise<IpcResult>;
      };
      sessions: {
        save: (
          data: PersistedSession,
          options?: { restoreDeleted?: boolean },
        ) => Promise<IpcResult>;
        load: (projectId: string, sessionId: string) => Promise<PersistedSession | null>;
        list: (projectId: string) => Promise<SessionListItem[]>;
        delete: (projectId: string, sessionId: string) => Promise<IpcResult>;
        search: (projectIds: string[], query: string) => Promise<{
          messageResults: SearchMessageResult[];
          sessionResults: SearchSessionResult[];
        }>;
        updateMeta: (projectId: string, sessionId: string, patch: {
          pinned?: boolean;
          folderId?: string | null;
          branch?: string;
        }) => Promise<IpcResult>;
      };
      folders: {
        list: (projectId: string) => Promise<ChatFolder[]>;
        create: (projectId: string, name: string) => Promise<ChatFolder>;
        delete: (projectId: string, folderId: string) => Promise<IpcResult>;
        rename: (projectId: string, folderId: string, name: string) => Promise<IpcResult>;
        pin: (projectId: string, folderId: string, pinned: boolean) => Promise<IpcResult>;
      };
      spaces: {
        list: () => Promise<Space[]>;
        save: (spaces: Space[]) => Promise<IpcResult>;
      };
      ccSessions: {
        list: (projectPath: string) => Promise<CCSessionInfo[]>;
        import: (projectPath: string, ccSessionId: string) => Promise<{
          messages?: UIMessage[];
          ccSessionId?: string;
          error?: string;
        }>;
      };
      ccConfig: {
        /** Resolve the effective gateway/provider config PccAgent applies to sessions. */
        effective: () => Promise<EffectiveCliConfig>;
        /** List all models available on each engine's effective upstream (/v1/models). */
        models: () => Promise<EffectiveCliModels>;
        /** Probe models from user-entered gateway credentials before saving settings. */
        probeModels: (input: { baseUrl: string; token: string }) => Promise<{ models: string[]; error: string | null }>;
      };
      files: {
        list: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        listAll: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        watch: (cwd: string) => Promise<IpcResult>;
        unwatch: (cwd: string) => Promise<IpcResult>;
        calculateDeepSize: (
          cwd: string,
          paths: string[],
        ) => Promise<{
          totalSize: number;
          fileCount: number;
          estimatedTokens: number;
          warnings: string[];
        }>;
        readMultiple: (
          cwd: string,
          paths: string[],
          deepPaths?: Set<string>,
        ) => Promise<
          Array<
            | { path: string; content: string; isDir?: false; error?: undefined }
            | { path: string; isDir: true; tree: string; error?: undefined }
            | { path: string; error: string; content?: undefined; isDir?: undefined }
          >
        >;
        onChanged: (callback: (data: FileWatchChangeEvent) => void) => () => void;
      };
      git: {
        discoverRepos: (projectPath: string) => Promise<GitRepoInfo[]>;
        status: (cwd: string) => Promise<GitStatus | { error: string }>;
        stage: (cwd: string, files: string[]) => Promise<IpcResult>;
        unstage: (cwd: string, files: string[]) => Promise<IpcResult>;
        stageAll: (cwd: string) => Promise<IpcResult>;
        unstageAll: (cwd: string) => Promise<IpcResult>;
        discard: (cwd: string, files: string[]) => Promise<IpcResult>;
        commit: (cwd: string, message: string) => Promise<IpcResult & { output?: string }>;
        branches: (cwd: string) => Promise<GitBranch[] | { error: string }>;
        checkout: (cwd: string, branch: string) => Promise<IpcResult>;
        createBranch: (cwd: string, name: string) => Promise<IpcResult>;
        createWorktree: (cwd: string, path: string, branch: string, fromRef?: string) => Promise<IpcResult & { path?: string; output?: string; setupResults?: Array<{ command: string; ok: boolean; output?: string; error?: string }> }>;
        removeWorktree: (cwd: string, path: string, force?: boolean) => Promise<IpcResult & { output?: string }>;
        pruneWorktrees: (cwd: string) => Promise<IpcResult & { output?: string }>;
        push: (cwd: string) => Promise<IpcResult & { output?: string }>;
        pull: (cwd: string) => Promise<IpcResult & { output?: string }>;
        fetch: (cwd: string) => Promise<IpcResult & { output?: string }>;
        diffFile: (cwd: string, file: string, staged: boolean) => Promise<{ diff?: string; error?: string }>;
        diffStat: (cwd: string) => Promise<{ additions: number; deletions: number }>;
        log: (cwd: string, count?: number) => Promise<GitLogEntry[] | { error: string }>;
        generateCommitMessage: (
          cwd: string,
          engine?: EngineId,
          sessionId?: string,
        ) => Promise<{ message?: string; error?: string }>;
      };
      terminal: {
        create: (options: { cwd?: string; cols?: number; rows?: number; spaceId?: string }) => Promise<{
          terminalId?: string;
          error?: string;
          errorCode?: import("@shared/types/settings").TerminalShellValidationErrorCode;
        }>;
        shellOptions: () => Promise<{
          options?: import("@shared/types/settings").TerminalShellOption[];
          error?: string;
        }>;
        validateShellPath: (shellPath: string) => Promise<
          import("@shared/types/settings").TerminalShellValidationResult
        >;
        selectShell: () => Promise<{ path?: string; canceled?: boolean; error?: string }>;
        list: () => Promise<{
          terminals?: Array<{
            terminalId: string;
            spaceId: string;
            createdAt: number;
            exited: boolean;
            exitCode: number | null;
          }>;
          error?: string;
        }>;
        snapshot: (terminalId: string) => Promise<{
          output?: string;
          seq?: number;
          cols?: number;
          rows?: number;
          exited?: boolean;
          exitCode?: number | null;
          error?: string;
        }>;
        write: (terminalId: string, data: string) => Promise<IpcResult>;
        resize: (terminalId: string, cols: number, rows: number) => Promise<IpcResult>;
        destroy: (terminalId: string) => Promise<{ ok?: boolean }>;
        destroySpace: (spaceId: string) => Promise<{ ok?: boolean }>;
        onData: (callback: (data: { terminalId: string; data: string; seq: number }) => void) => () => void;
        onExit: (callback: (data: { terminalId: string; exitCode: number }) => void) => () => void;
      };
      acp: {
        log: (label: string, data: unknown) => void;
        start: (options: { agentId: string; cwd: string; mcpServers?: McpServerConfig[]; initialConfigOptions?: ACPConfigOption[] }) => Promise<ACPStartResult>;
        authenticate: (sessionId: string, methodId: string) => Promise<ACPAuthenticateResult>;
        prompt: (sessionId: string, text: string, images?: unknown[]) => Promise<ACPPromptResult>;
        stop: (sessionId: string) => Promise<IpcResult>;
        reloadSession: (sessionId: string, mcpServers?: McpServerConfig[], cwd?: string) => Promise<IpcResult & { supportsLoad?: boolean }>;
        reviveSession: (options: { agentId: string; cwd: string; sessionId?: string; agentSessionId?: string; mcpServers?: McpServerConfig[]; initialConfigOptions?: ACPConfigOption[] }) => Promise<ACPReviveResult>;
        cancel: (sessionId: string) => Promise<IpcResult>;
        abortPendingStart: () => Promise<{ ok?: boolean }>;
        respondPermission: (sessionId: string, requestId: string, optionId: string) => Promise<IpcResult>;
        setConfig: (sessionId: string, configId: string, value: string) => Promise<{ configOptions?: ACPConfigOption[]; error?: string }>;
        attachRenderer: (sessionId: string) => Promise<IpcResult & { replayed?: number }>;
        getConfigOptions: (sessionId: string) => Promise<{ configOptions?: ACPConfigOption[] }>;
        getAvailableCommands: (sessionId: string) => Promise<{ commands?: ACPAvailableCommand[] }>;
        onEvent: (callback: (data: ACPSessionEvent) => void) => () => void;
        onPermissionRequest: (callback: (data: ACPPermissionEvent) => void) => () => void;
        onTurnComplete: (callback: (data: ACPTurnCompleteEvent) => void) => () => void;
        onTurnTransportError: (callback: (data: ACPTransportErrorEvent) => void) => () => void;
        onExit: (callback: (data: { _sessionId: string; code: number | null; turnId?: string; error?: string; errorCode?: string }) => void) => () => void;
      };
      mcp: {
        list: () => Promise<McpServerConfig[]>;
        add: (server: McpServerConfig) => Promise<IpcResult>;
        remove: (name: string) => Promise<IpcResult>;
        authenticate: (serverName: string, serverUrl: string) => Promise<IpcResult>;
        authStatus: (serverName: string) => Promise<{ hasToken: boolean; expiresAt?: number }>;
        probe: (servers: McpServerConfig[]) => Promise<Array<{ name: string; status: "connected" | "needs-auth" | "failed"; error?: string }>>;
      };
      plugins: {
        skills: {
          search: (query: string) => Promise<CatalogResult<SkillCatalogItem> | { error: string }>;
          listInstalled: () => Promise<
            { items: InstalledSkillRecord[] } | { error: string }
          >;
          install: (request: SkillInstallRequest) => Promise<
            { item: InstalledSkillRecord }
            | { error: string; requiresConfirmation?: boolean }
          >;
          remove: (id: string) => Promise<IpcResult>;
        };
        mcp: {
          list: (query: string) => Promise<CatalogResult<McpCatalogItem> | { error: string }>;
          listInstalled: () => Promise<{ items: InstalledMcpRecord[] } | { error: string }>;
          install: (request: McpCatalogInstallRequest) => Promise<McpCatalogInstallResult>;
        };
      };
      agents: {
        list: () => Promise<InstalledAgent[]>;
        save: (agent: InstalledAgent) => Promise<IpcResult>;
        delete: (id: string) => Promise<IpcResult>;
        updateCachedConfig: (agentId: string, configOptions: ACPConfigOption[]) => Promise<{ ok?: boolean }>;
        updateCachedSlashCommands: (agentId: string, commands: SlashCommand[]) => Promise<{ ok?: boolean }>;
        /** Batch-check if binary-only agents are installed on the system PATH. */
        checkBinaries: (
          agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>,
        ) => Promise<Record<string, { path: string; args?: string[] } | null>>;
        /** Preferred ACP registry platform keys for the current machine. */
        getPlatformKeys: () => Promise<string[]>;
        /** Resolved PATH and version details for the supported Pi runtime pair. */
        getPiRuntimeStatus: () => Promise<PiRuntimeStatus>;
        /** Local-only Pi command catalog for drafts; does not start an ACP process. */
        listPiDraftCommands: (cwd: string) => Promise<{ commands: SlashCommand[] }>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (patch: Partial<AppSettings>) => Promise<IpcResult>;
        /** Subscribe to settings changes pushed from the main process. */
        onChanged: (callback: (settings: AppSettings) => void) => () => void;
      };
      wechat: {
        getState: () => Promise<WeChatBridgeState>;
        setConfig: (patch: Partial<WeChatBridgeConfig>) => Promise<{ ok: boolean; state?: WeChatBridgeState; error?: string }>;
        login: () => Promise<{ ok: boolean; error?: string }>;
        cancelLogin: () => Promise<IpcResult>;
        logout: () => Promise<WeChatBridgeState>;
        start: () => Promise<{ ok: boolean; error?: string }>;
        stop: () => Promise<IpcResult>;
        /** Tear down and re-establish the live connection without re-scanning the QR. */
        reconnect: () => Promise<{ ok: boolean; error?: string }>;
        /** Continue a WeChat conversation from the desktop (relays the reply to WeChat). */
        send: (args: { sessionId: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
        /** Cancel the active Pi ACP turn owned by this WeChat session. */
        cancel: (args: { sessionId: string }) => Promise<{ ok: boolean; error?: string }>;
        /** Subscribe to bridge events (qrcode, login status, state, activity, session-upsert). */
        onEvent: (callback: (event: WeChatBridgeEvent) => void) => () => void;
      };
      account: {
        getConfig: () => Promise<AccountConfig>;
        getStatus: () => Promise<AccountStatus>;
        getBalance: () => Promise<AccountBalanceResult>;
        getOverview: () => Promise<AccountOverview>;
        getModels: () => Promise<AccountModelsResult>;
        getCachedUsageStats: () => Promise<UsageStats | null>;
        getUsageStats: (force?: boolean) => Promise<UsageStatsResult>;
      };
      accountAuth: {
        getStatus: () => Promise<AccountAuthSnapshot>;
        beginAuthorization: () => Promise<AccountAuthActionResult>;
        cancelAuthorization: () => Promise<AccountAuthActionResult>;
        reauthorize: () => Promise<AccountAuthActionResult>;
        continueAsGuest: () => Promise<AccountAuthActionResult>;
        logoutAndRevoke: () => Promise<AccountAuthActionResult>;
        clearLocalAuthorization: () => Promise<AccountAuthActionResult>;
        onChanged: (callback: (snapshot: AccountAuthSnapshot) => void) => () => void;
      };
      jira: {
        getConfig: (projectId: string) => Promise<JiraProjectConfig | null>;
        saveConfig: (projectId: string, config: JiraProjectConfig) => Promise<IpcResult>;
        deleteConfig: (projectId: string) => Promise<IpcResult>;
        authenticate: (
          instanceUrl: string,
          method: "oauth" | "apitoken",
          apiToken?: string,
          email?: string
        ) => Promise<IpcResult>;
        authStatus: (instanceUrl: string) => Promise<{ hasToken: boolean }>;
        logout: (instanceUrl: string) => Promise<IpcResult>;
        getProjects: (instanceUrl: string) => Promise<JiraProjectSummary[] | { error: string }>;
        getBoards: (params: JiraGetBoardsParams) => Promise<JiraBoard[] | { error: string }>;
        getBoardConfiguration: (params: JiraGetSprintsParams) => Promise<JiraBoardConfiguration | { error: string }>;
        getSprints: (params: JiraGetSprintsParams) => Promise<JiraSprint[] | { error: string }>;
        getIssues: (params: JiraGetIssuesParams) => Promise<JiraIssue[] | { error: string }>;
        getComments: (params: JiraGetCommentsParams) => Promise<JiraComment[] | { error: string }>;
        getTransitions: (params: JiraGetTransitionsParams) => Promise<JiraTransition[] | { error: string }>;
        transitionIssue: (params: JiraTransitionIssueParams) => Promise<IpcResult>;
      };
      speech: {
        /** Triggers macOS native dictation (Cocoa startDictation: selector). Returns { ok: false } on non-macOS. */
        startNativeDictation: () => Promise<{ ok: boolean; reason?: string }>;
        /** Returns the OS platform string (darwin, win32, linux) */
        getPlatform: () => Promise<string>;
        /** Requests microphone permission (macOS system dialog). Returns { granted } on all platforms. */
        requestMicPermission: () => Promise<{ granted: boolean }>;
      };
      updater: {
        onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
        onDownloadProgress: (cb: (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => () => void;
        onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void;
        onInstallError: (cb: (error: { code?: string; message: string }) => void) => () => void;
        download: () => Promise<unknown>;
        install: () => Promise<{ ok: boolean; cancelled?: boolean }>;
        check: () => Promise<unknown>;
        currentVersion: () => Promise<string>;
        isPreRelease: () => Promise<PreReleaseInfo>;
        onPreReleaseStatus: (cb: (info: PreReleaseInfo) => void) => () => void;
      };
    };
  }
}
