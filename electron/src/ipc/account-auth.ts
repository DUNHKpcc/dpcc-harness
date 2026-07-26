import os from "node:os";
import type { BrowserWindow } from "electron";
import { app, ipcMain, shell } from "electron";
import type { AccountAuthSnapshot } from "@shared/types/account-auth";
import { AccountAuthorizationCoordinator } from "../lib/account-auth-flow";
import { migrateLegacyAccountCredentials } from "../lib/account-credential-store";
import { reportError } from "../lib/error-utils";
import { reclaimMacDockFocus } from "../lib/macos-dock-focus";
import { safeSend } from "../lib/safe-send";
import { stopDesktopAccountSessions as stopClaudeDesktopAccountSessions } from "./claude-sessions";
import { stopDesktopAccountSessions as stopCodexDesktopAccountSessions } from "./codex-sessions";

let coordinator: AccountAuthorizationCoordinator | null = null;
let mainWindowGetter: (() => BrowserWindow | null) | null = null;

function deviceName(): string {
  const hostname = os.hostname().replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (hostname || `${app.getName()} device`).slice(0, 80);
}

function bringAccountWindowToFront(): void {
  if (!mainWindowGetter) return;
  const win = mainWindowGetter();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  reclaimMacDockFocus(mainWindowGetter, "account-authorization-complete");
}

function createCoordinator(): AccountAuthorizationCoordinator {
  const metadata = {
    deviceName: deviceName(),
    platform: `${process.platform}-${process.arch}`,
    appVersion: app.getVersion(),
  };
  return new AccountAuthorizationCoordinator(
    metadata,
    (url) => {
      // The coordinator validates the exact HTTPS origin, path, and request token first.
      // nosemgrep: harnss-shell-open-external-unvalidated
      return shell.openExternal(url);
    },
    (snapshot) => {
      if (mainWindowGetter) {
        safeSend(mainWindowGetter, "account-auth:changed", snapshot);
      }
      if (snapshot.status === "connected") {
        bringAccountWindowToFront();
      }
    },
    undefined,
    undefined,
    (reason) => {
      stopClaudeDesktopAccountSessions(reason);
      stopCodexDesktopAccountSessions(reason);
    },
  );
}

function getCoordinator(): AccountAuthorizationCoordinator {
  coordinator ??= createCoordinator();
  return coordinator;
}

export function initialize(): void {
  try {
    migrateLegacyAccountCredentials(deviceName());
  } catch (error) {
    reportError("ACCOUNT_AUTH_MIGRATION", error);
  }
  coordinator ??= createCoordinator();
  coordinator.resumePendingConfirmation();
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getMainWindow;

  ipcMain.handle("account-auth:get-status", (): AccountAuthSnapshot => {
    return getCoordinator().getSnapshot();
  });
  ipcMain.handle("account-auth:begin", () => {
    return getCoordinator().beginAuthorization();
  });
  ipcMain.handle("account-auth:cancel", () => {
    return getCoordinator().cancelAuthorization();
  });
  ipcMain.handle("account-auth:reauthorize", () => {
    return getCoordinator().reauthorize();
  });
  ipcMain.handle("account-auth:continue-as-guest", () => {
    return getCoordinator().continueAsGuest();
  });
  ipcMain.handle("account-auth:logout-and-revoke", () => {
    return getCoordinator().logoutAndRevoke();
  });
  ipcMain.handle("account-auth:clear-local", () => {
    return getCoordinator().clearLocalAuthorization();
  });
}

export function dispose(): void {
  coordinator?.dispose();
  coordinator = null;
}

export function markTokenRejected(): void {
  getCoordinator().markTokenRejected();
}
