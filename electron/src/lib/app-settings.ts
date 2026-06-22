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
import type { AppSettings, NotificationSettings } from "@shared/types/settings";

// Re-export shared types so existing `import from "./app-settings"` consumers still work
export type { AppSettings, MacBackgroundEffect, PreferredEditor, VoiceDictationMode, NotificationTrigger, NotificationEventSettings, NotificationSettings, CodexBinarySource, ClaudeBinarySource, ClaudeGatewaySettings, CodexGatewaySettings, UpdateSource } from "@shared/types/settings";

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
  accountAccessToken: "",
  accountUserId: "",
};

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
    };
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
