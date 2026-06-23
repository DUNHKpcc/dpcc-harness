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
} from "@shared/types/settings";

// Re-export shared types so existing `import from "./app-settings"` consumers still work
export type { AppSettings, MacBackgroundEffect, PreferredEditor, VoiceDictationMode, NotificationTrigger, NotificationEventSettings, NotificationSettings, CodexBinarySource, ClaudeBinarySource, ClaudeGatewaySettings, CodexGatewaySettings, DpccUpstreamSettings, UpdateSource } from "@shared/types/settings";

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
  showDevFillInChatTitleBar: false,
  showJiraBoard: false,
  macBackgroundEffect: "liquid-glass",
  analyticsEnabled: true,
  claudeGateway: { enabled: false, baseUrl: "", authToken: "", model: "" },
  codexGateway: { enabled: false, name: "", baseUrl: "", apiKey: "", model: "" },
  dpccUpstream: { baseUrl: "", claudeToken: "", codexToken: "", claudeModel: "", codexModel: "" },
  accountAccessToken: "",
  accountUserId: "",
};

const DPCC_HOST_RE = /dpccgaming\.xyz/i;

/** A gateway base URL is "DPCC-shaped" when it's empty or points at the DPCC host. */
function looksLikeDpcc(baseUrl: string | undefined): boolean {
  const u = (baseUrl ?? "").trim();
  return u === "" || DPCC_HOST_RE.test(u);
}

/**
 * One-time migration for settings written before `dpccUpstream` existed.
 *
 * Previously the DPCC API account entry stored its key in claudeGateway/
 * codexGateway with `enabled=true`. Those gateways now mean "custom third-party
 * gateway" only (the highest-priority tier), while the DPCC default upstream has
 * its own field (the lowest tier). Move any DPCC-shaped gateway credentials into
 * `dpccUpstream` and clear them from the gateway fields so a DPCC account isn't
 * mistaken for a custom gateway. Custom (non-DPCC) gateways are left untouched.
 */
function migrateLegacyDpcc(parsed: Partial<AppSettings>): {
  dpccUpstream: DpccUpstreamSettings;
  claudeGateway: ClaudeGatewaySettings;
  codexGateway: CodexGatewaySettings;
} {
  const cg: ClaudeGatewaySettings = { ...DEFAULTS.claudeGateway, ...parsed.claudeGateway };
  const xg: CodexGatewaySettings = { ...DEFAULTS.codexGateway, ...parsed.codexGateway };
  const claudeIsDpcc = !!(cg.enabled && cg.authToken.trim() && looksLikeDpcc(cg.baseUrl));
  const codexIsDpcc = !!(xg.enabled && xg.apiKey.trim() && looksLikeDpcc(xg.baseUrl));

  const dpccBaseUrl =
    (claudeIsDpcc && cg.baseUrl.trim()) ||
    (codexIsDpcc && xg.baseUrl.trim().replace(/\/v1$/, "")) ||
    "";

  return {
    dpccUpstream: {
      baseUrl: dpccBaseUrl,
      claudeToken: claudeIsDpcc ? cg.authToken.trim() : "",
      codexToken: codexIsDpcc ? xg.apiKey.trim() : "",
      claudeModel: claudeIsDpcc ? cg.model.trim() : "",
      codexModel: codexIsDpcc ? xg.model.trim() : "",
    },
    claudeGateway: claudeIsDpcc ? { ...DEFAULTS.claudeGateway } : cg,
    codexGateway: codexIsDpcc ? { ...DEFAULTS.codexGateway } : xg,
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
    // Settings predating the dpccUpstream field need a one-time migration that
    // splits DPCC account creds out of the gateway fields (see migrateLegacyDpcc).
    const needsDpccMigration = parsed.dpccUpstream === undefined;
    const migrated = needsDpccMigration ? migrateLegacyDpcc(parsed) : null;
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
      // Deep-merge dpccUpstream so a hand-edited partial object can't leave string
      // fields undefined — the resolver calls .trim() on them. (migrated, when set,
      // already contains a complete object and overrides this below.)
      dpccUpstream: { ...DEFAULTS.dpccUpstream, ...parsed.dpccUpstream },
      ...(migrated ?? {}),
    };
    if (migrated) {
      // Persist the migration once so the legacy gateway creds are physically
      // moved and this branch never runs again for this user.
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
  } catch {
    // Non-fatal — setting is still cached in memory for this session
  }
  return next;
}
