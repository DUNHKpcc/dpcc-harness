/**
 * Main-process settings store — JSON file in the app data directory.
 *
 * Unlike useSettings (renderer localStorage), this store is readable at
 * startup before any BrowserWindow exists. Use it for settings that the
 * main process needs synchronously (e.g. autoUpdater.allowPrerelease).
 *
 * File location: {userData}/pcc-agent-data/settings.json
 */

import path from "path";
import fs from "fs";
import { getDataDir } from "./data-dir";
import type {
  AppSettings,
  NotificationSettings,
  ClaudeGatewaySettings,
  CodexGatewaySettings,
  DpccUpstreamSettings,
  CliConfigSource,
} from "@shared/types/settings";
import {
  CLAUDE_GATEWAY_MODEL_PRESETS,
  CODEX_GATEWAY_MODEL_PRESETS,
  buildGatewayModelMappings,
} from "@shared/lib/gateway-models";
import { isActiveThirdPartyGateway, isDpccUpstreamUrl } from "@shared/lib/upstream-routing";

// Re-export shared types so existing `import from "./app-settings"` consumers still work
export type { AppSettings, MacBackgroundEffect, PreferredEditor, VoiceDictationMode, NotificationTrigger, NotificationEventSettings, NotificationSettings, CodexBinarySource, ClaudeBinarySource, ClaudeGatewaySettings, CodexGatewaySettings, DpccUpstreamSettings, UpdateSource, CliConfigSource } from "@shared/types/settings";

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  exitPlanMode: { osNotification: "unfocused", sound: "always" },
  permissions: { osNotification: "unfocused", sound: "unfocused" },
  askUserQuestion: { osNotification: "unfocused", sound: "always" },
  sessionComplete: { osNotification: "unfocused", sound: "always" },
};

const DEFAULTS: AppSettings = {
  allowPrereleaseUpdates: false,
  updateSource: "github",
  defaultChatLimit: 10,
  preferredEditor: "auto",
  voiceDictation: "native",
  notifications: NOTIFICATION_DEFAULTS,
  codexClientName: "PccAgent",
  codexBinarySource: "builtin",
  codexCustomBinaryPath: "",
  claudeBinarySource: "builtin",
  claudeCustomBinaryPath: "",
  binarySourceDefaultsMigrated: true,
  showDevFillInChatTitleBar: false,
  showJiraBoard: false,
  macBackgroundEffect: "liquid-glass",
  analyticsEnabled: true,
  claudeGateway: { enabled: false, baseUrl: "", authToken: "", model: "", modelMappings: CLAUDE_GATEWAY_MODEL_PRESETS },
  codexGateway: { enabled: false, name: "", baseUrl: "", apiKey: "", model: "", modelMappings: CODEX_GATEWAY_MODEL_PRESETS },
  cliConfigSource: "default",
  claudeCliConfigSource: "default",
  codexCliConfigSource: "default",
  dpccUpstream: { baseUrl: "", claudeToken: "", codexToken: "", claudeModel: "", codexModel: "" },
  accountAccessToken: "",
  accountUserId: "",
};

/**
 * Normalizes DPCC credentials into the default upstream tier.
 *
 * Previously the DPCC API account entry stored its key in claudeGateway/
 * codexGateway with `enabled=true`. Those gateways now mean "custom third-party
 * gateway" only, while the DPCC official default upstream has its own field and
 * is selected from Current Config. Move any
 * DPCC-shaped gateway credentials into
 * `dpccUpstream` and clear them from the gateway fields so a DPCC account isn't
 * mistaken for a custom gateway. Custom (non-DPCC) gateways are left untouched.
 */
function migrateDpccGatewaySettings(parsed: Partial<AppSettings>): {
  dpccUpstream: DpccUpstreamSettings;
  claudeGateway: ClaudeGatewaySettings;
  codexGateway: CodexGatewaySettings;
  claudeGatewayWasDpcc: boolean;
  codexGatewayWasDpcc: boolean;
} {
  const cg: ClaudeGatewaySettings = { ...DEFAULTS.claudeGateway, ...parsed.claudeGateway };
  const xg: CodexGatewaySettings = { ...DEFAULTS.codexGateway, ...parsed.codexGateway };
  const dpcc = { ...DEFAULTS.dpccUpstream, ...parsed.dpccUpstream };
  const claudeGatewayWasDpcc = Boolean(
    (cg.baseUrl.trim() || cg.authToken.trim()) && isDpccUpstreamUrl(cg.baseUrl),
  );
  const codexGatewayWasDpcc = Boolean(
    (xg.baseUrl.trim() || xg.apiKey.trim()) && isDpccUpstreamUrl(xg.baseUrl),
  );

  const dpccBaseUrl =
    dpcc.baseUrl.trim() ||
    (claudeGatewayWasDpcc && cg.baseUrl.trim()) ||
    (codexGatewayWasDpcc && xg.baseUrl.trim().replace(/\/v1$/, "")) || "";

  return {
    dpccUpstream: {
      baseUrl: dpccBaseUrl,
      claudeToken: dpcc.claudeToken.trim() || (claudeGatewayWasDpcc ? cg.authToken.trim() : ""),
      codexToken: dpcc.codexToken.trim() || (codexGatewayWasDpcc ? xg.apiKey.trim() : ""),
      claudeModel: dpcc.claudeModel.trim() || (claudeGatewayWasDpcc ? cg.model.trim() : ""),
      codexModel: dpcc.codexModel.trim() || (codexGatewayWasDpcc ? xg.model.trim() : ""),
    },
    claudeGateway: claudeGatewayWasDpcc ? { ...DEFAULTS.claudeGateway } : cg,
    codexGateway: codexGatewayWasDpcc ? { ...DEFAULTS.codexGateway } : xg,
    claudeGatewayWasDpcc,
    codexGatewayWasDpcc,
  };
}

function migrateBinarySourceDefaults(parsed: Partial<AppSettings>): Partial<AppSettings> | null {
  if (parsed.binarySourceDefaultsMigrated) return null;

  const patch: Partial<AppSettings> = {
    binarySourceDefaultsMigrated: true,
  };

  if (parsed.claudeBinarySource !== "custom" || !parsed.claudeCustomBinaryPath?.trim()) {
    patch.claudeBinarySource = "builtin";
  }
  if (parsed.codexBinarySource !== "custom" || !parsed.codexCustomBinaryPath?.trim()) {
    patch.codexBinarySource = "builtin";
  }

  return patch;
}

function hasLegacyThirdPartyGatewaySelection(parsed: Partial<AppSettings>): boolean {
  if (parsed.cliConfigSource !== undefined) return false;

  const cg: ClaudeGatewaySettings = { ...DEFAULTS.claudeGateway, ...parsed.claudeGateway };
  const xg: CodexGatewaySettings = { ...DEFAULTS.codexGateway, ...parsed.codexGateway };
  const claudeCustomGateway = isActiveThirdPartyGateway({
    enabled: cg.enabled,
    baseUrl: cg.baseUrl,
    credential: cg.authToken,
  });
  const codexCustomGateway = isActiveThirdPartyGateway({
    enabled: xg.enabled,
    baseUrl: xg.baseUrl,
    credential: xg.apiKey,
  });
  return claudeCustomGateway || codexCustomGateway;
}

function normalizeCliConfigSource(source: unknown): CliConfigSource | null {
  return source === "local" || source === "gateway" || source === "default" ? source : null;
}

function legacyCliConfigSource(parsed: Partial<AppSettings>): CliConfigSource {
  const explicit = normalizeCliConfigSource(parsed.cliConfigSource);
  if (explicit) return explicit;
  return hasLegacyThirdPartyGatewaySelection(parsed) ? "gateway" : "default";
}

function resolveCliConfigSources(parsed: Partial<AppSettings>): Pick<AppSettings, "cliConfigSource" | "claudeCliConfigSource" | "codexCliConfigSource"> {
  const legacy = legacyCliConfigSource(parsed);
  return {
    cliConfigSource: legacy,
    claudeCliConfigSource: normalizeCliConfigSource(parsed.claudeCliConfigSource) ?? legacy,
    codexCliConfigSource: normalizeCliConfigSource(parsed.codexCliConfigSource) ?? legacy,
  };
}

function migrateCliConfigSources(
  parsed: Partial<AppSettings>,
  sources: Pick<AppSettings, "cliConfigSource" | "claudeCliConfigSource" | "codexCliConfigSource">,
): Partial<Pick<AppSettings, "cliConfigSource" | "claudeCliConfigSource" | "codexCliConfigSource">> | null {
  const patch: Partial<Pick<AppSettings, "cliConfigSource" | "claudeCliConfigSource" | "codexCliConfigSource">> = {};
  if (normalizeCliConfigSource(parsed.cliConfigSource) !== sources.cliConfigSource) patch.cliConfigSource = sources.cliConfigSource;
  if (normalizeCliConfigSource(parsed.claudeCliConfigSource) !== sources.claudeCliConfigSource) patch.claudeCliConfigSource = sources.claudeCliConfigSource;
  if (normalizeCliConfigSource(parsed.codexCliConfigSource) !== sources.codexCliConfigSource) patch.codexCliConfigSource = sources.codexCliConfigSource;
  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizeClaudeGateway(gateway: Partial<ClaudeGatewaySettings> | undefined): ClaudeGatewaySettings {
  const merged = { ...DEFAULTS.claudeGateway, ...gateway };
  return {
    ...merged,
    modelMappings: buildGatewayModelMappings("claude", merged.modelMappings),
  };
}

function normalizeCodexGateway(gateway: Partial<CodexGatewaySettings> | undefined): CodexGatewaySettings {
  const merged = { ...DEFAULTS.codexGateway, ...gateway };
  return {
    ...merged,
    modelMappings: buildGatewayModelMappings("codex", merged.modelMappings),
  };
}

// ── Internal state ──

let cached: AppSettings | null = null;
// mtime of settings.json when `cached` was populated. Lets getAppSettings()
// detect out-of-band edits (the user editing settings.json while the app runs,
// or another tool writing it) and reload — otherwise the first-read cache would
// serve stale values forever (B9), which surfaced as the read-only "Current
// Config" panel showing values that no longer match disk.
let cachedMtimeMs = 0;

function filePath(): string {
  return path.join(getDataDir(), "settings.json");
}

/** mtime of settings.json, or 0 when the file is missing/unreadable. */
function readMtimeMs(): number {
  try {
    return fs.statSync(filePath()).mtimeMs;
  } catch {
    return 0;
  }
}

// ── Public API ──

/** Read the full settings object (cached, with disk-change detection via mtime). */
export function getAppSettings(): AppSettings {
  const mtimeMs = readMtimeMs();
  // Serve the cache only while the on-disk file hasn't changed since we read it.
  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const raw = fs.readFileSync(filePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const dpccGatewayMigration = migrateDpccGatewaySettings(parsed);
    const hasDpccGatewayMigration =
      dpccGatewayMigration.claudeGatewayWasDpcc || dpccGatewayMigration.codexGatewayWasDpcc;
    const binarySourceMigration = migrateBinarySourceDefaults(parsed);
    const resolvedCliConfigSources = resolveCliConfigSources(parsed);
    const cliConfigSources = {
      ...resolvedCliConfigSources,
      claudeCliConfigSource:
        dpccGatewayMigration.claudeGatewayWasDpcc && resolvedCliConfigSources.claudeCliConfigSource === "gateway"
          ? "default"
          : resolvedCliConfigSources.claudeCliConfigSource,
      codexCliConfigSource:
        dpccGatewayMigration.codexGatewayWasDpcc && resolvedCliConfigSources.codexCliConfigSource === "gateway"
          ? "default"
          : resolvedCliConfigSources.codexCliConfigSource,
    };
    const cliConfigSourceMigration = migrateCliConfigSources(parsed, cliConfigSources);
    // Merge with defaults so newly added keys are always present.
    // Deep-merge `notifications` so upgrading users get defaults for each event type
    // even if their settings.json has a partial or missing notifications object.
    const parsedNotif = parsed.notifications as Partial<NotificationSettings> | undefined;
    cached = {
      ...DEFAULTS,
      ...parsed,
      notifications: {
        exitPlanMode: { ...NOTIFICATION_DEFAULTS.exitPlanMode, ...parsedNotif?.exitPlanMode },
        permissions: { ...NOTIFICATION_DEFAULTS.permissions, ...parsedNotif?.permissions },
        askUserQuestion: { ...NOTIFICATION_DEFAULTS.askUserQuestion, ...parsedNotif?.askUserQuestion },
        sessionComplete: { ...NOTIFICATION_DEFAULTS.sessionComplete, ...parsedNotif?.sessionComplete },
      },
      dpccUpstream: hasDpccGatewayMigration
        ? dpccGatewayMigration.dpccUpstream
        : { ...DEFAULTS.dpccUpstream, ...parsed.dpccUpstream },
      claudeGateway: hasDpccGatewayMigration
        ? normalizeClaudeGateway(dpccGatewayMigration.claudeGateway)
        : normalizeClaudeGateway(parsed.claudeGateway),
      codexGateway: hasDpccGatewayMigration
        ? normalizeCodexGateway(dpccGatewayMigration.codexGateway)
        : normalizeCodexGateway(parsed.codexGateway),
      ...cliConfigSources,
      ...(binarySourceMigration ?? {}),
      ...(cliConfigSourceMigration ?? {}),
    };
    if (hasDpccGatewayMigration || binarySourceMigration || cliConfigSourceMigration) {
      // Persist the migration once so the legacy gateway creds are physically
      // moved and one-time default normalizations never run again for this user.
      try {
        fs.writeFileSync(filePath(), JSON.stringify(cached, null, 2), "utf-8");
        cachedMtimeMs = readMtimeMs();
        return cached;
      } catch {
        // Write failed — keep the migrated values in memory for this session.
      }
    }
  } catch {
    cached = { ...DEFAULTS };
  }
  cachedMtimeMs = mtimeMs;
  return cached;
}

/** Read a single setting by key. */
export function getAppSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getAppSettings()[key];
}

/** Update one or more settings and persist to disk. */
export function setAppSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getAppSettings();
  const next = { ...current, ...patch };
  cached = next;

  try {
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), "utf-8");
    // Keep the cache key in sync with the file we just wrote so the next read
    // doesn't see our own write as an external change and reload needlessly.
    cachedMtimeMs = readMtimeMs();
  } catch (error) {
    cached = current;
    cachedMtimeMs = readMtimeMs();
    throw error;
  }
  return next;
}
