export interface ReleaseHistoryEntry {
  version: string;
  date: string;
  changeKeys: readonly string[];
  releaseUrl: string;
}

export const INITIAL_RELEASE_HISTORY_LIMIT = 3;

const RELEASES_BASE_URL = "https://github.com/DUNHKpcc/dpcc-harness/releases/tag";

function release(version: string, date: string, changeKeys: readonly string[]): ReleaseHistoryEntry {
  return {
    version,
    date,
    changeKeys,
    releaseUrl: `${RELEASES_BASE_URL}/v${version}`,
  };
}

/** Bundled release history, newest first, so settings remain useful offline. */
export const RELEASE_HISTORY: readonly ReleaseHistoryEntry[] = [
  release("2.1.6", "2026-07-23", [
    "windowsStore",
    "windowsTray",
    "nativeNotifications",
    "gatewayReliability",
    "agentCompletion",
    "supportChannels",
    "runtimeUpdate",
  ]),
  release("2.1.5", "2026-07-12", [
    "requestTracking",
    "sessionRecovery",
    "modelControls",
    "startupLayout",
    "settingsPolish",
  ]),
  release("2.1.4", "2026-07-11", ["modelSync", "upstreamSwitch", "sparkEffort", "runtimeUpdate"]),
  release("2.1.3", "2026-07-07", ["panelMenus", "interactionRegression"]),
  release("2.1.2", "2026-07-07", ["portableGit", "chatSection", "workspaceState", "settingsPolish"]),
  release("2.1.1", "2026-07-02", ["hideClaudeHelper", "nodeRuntime"]),
  release("2.1.0", "2026-07-02", ["mcpIsolation", "configOwnership"]),
  release("2.0.9", "2026-07-01", ["dockHelper", "processIdentity"]),
  release("2.0.8", "2026-07-01", ["requestUsage", "currentConfig", "gatewayModels", "codexDownload"]),
  release("2.0.7", "2026-06-26", ["dpccDefaults", "gitNoise"]),
  release("2.0.6", "2026-06-26", ["windowsCodex", "fileAttachments", "processCleanup"]),
  release("2.0.5", "2026-06-25", ["startupFlicker", "fileReferences", "engineExit"]),
  release("2.0.4", "2026-06-24", ["sessionCleanup", "rendererState", "windowsPath", "attachmentPicker"]),
  release("2.0.3", "2026-06-22", ["dpccAccount", "contextCache", "utilityRouting"]),
  release("2.0.2", "2026-06-22", ["wechatRecovery", "builtinBinaries", "updateMirror"]),
  release("2.0.1", "2026-06-21", ["updateSource", "domesticMirror"]),
  release("2.0.0", "2026-06-20", ["streamingPerformance", "processCleanup", "wechatSessions", "windowsEditor"]),
  release("1.0.2", "2026-06-19", ["localizedNotifications", "localizedUpdater"]),
  release("1.0.1", "2026-06-19", ["installerNames", "releaseAssets", "brandingCleanup"]),
  release("1.0.0", "2026-06-19", ["multiEngine", "workspaceTools", "delegation", "firstRelease"]),
];

export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function isCurrentRelease(releaseVersion: string, currentVersion: string): boolean {
  return normalizeReleaseVersion(releaseVersion) === normalizeReleaseVersion(currentVersion);
}

export function releaseTranslationKey(version: string): string {
  return `v${normalizeReleaseVersion(version).replaceAll(".", "_")}`;
}
