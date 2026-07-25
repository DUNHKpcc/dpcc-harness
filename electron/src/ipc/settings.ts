import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { getAppSettings, setAppSettings, type AppSettings } from "../lib/app-settings";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";

// Listeners notified when any setting changes (used by updater, etc.)
type SettingsListener = (settings: AppSettings) => void;
const listeners: SettingsListener[] = [];

export function rendererSafeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    dpccUpstream: {
      ...settings.dpccUpstream,
      claudeToken: "",
      codexToken: "",
    },
    accountAccessToken: "",
    accountUserId: "",
  };
}

function rendererSafePatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const current = getAppSettings();
  const safe = { ...patch };
  delete safe.accountAccessToken;
  delete safe.accountUserId;
  if (patch.dpccUpstream) {
    safe.dpccUpstream = {
      ...current.dpccUpstream,
      ...patch.dpccUpstream,
      claudeToken: current.dpccUpstream.claudeToken,
      codexToken: current.dpccUpstream.codexToken,
    };
  }
  return safe;
}

export function onSettingsChanged(cb: SettingsListener): void {
  listeners.push(cb);
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("settings:get", () => {
    try {
      return rendererSafeSettings(getAppSettings());
    } catch (err) {
      reportError("SETTINGS:GET_ERR", err);
      return null;
    }
  });

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) => {
    try {
      const next = setAppSettings(rendererSafePatch(patch));
      // Notify in-process listeners (e.g. autoUpdater)
      for (const cb of listeners) cb(next);
      // Notify renderer so reactive subscribers update without polling
      safeSend(getMainWindow, "settings:changed", rendererSafeSettings(next));
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("SETTINGS:SET_ERR", err);
      return { error: errMsg };
    }
  });
}
