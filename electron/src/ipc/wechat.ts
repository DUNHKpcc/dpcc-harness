import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import type { WeChatBridgeConfig } from "@shared/types/wechat";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import { getWeChatBridge } from "../lib/wechat/bridge";

let unsubscribe: (() => void) | null = null;

export function register(getMainWindow: () => BrowserWindow | null): void {
  const bridge = getWeChatBridge();
  bridge.attachWindow(getMainWindow);

  unsubscribe?.();
  unsubscribe = bridge.onEvent((event) => safeSend(getMainWindow, "wechat:event", event));

  ipcMain.handle("wechat:get-state", () => bridge.getState());
  ipcMain.handle("wechat:set-config", (_event, patch: Partial<WeChatBridgeConfig>) => {
    try {
      return { ok: true, state: bridge.setConfig(patch) };
    } catch (err) {
      return { ok: false, error: reportError("WECHAT_SET_CONFIG", err) };
    }
  });
  ipcMain.handle("wechat:login", () => bridge.login());
  ipcMain.handle("wechat:cancel-login", () => {
    bridge.cancelLogin();
    return { ok: true };
  });
  ipcMain.handle("wechat:logout", () => bridge.logout());
  ipcMain.handle("wechat:start", () => bridge.start());
  ipcMain.handle("wechat:stop", () => {
    bridge.stop();
    return { ok: true };
  });
  ipcMain.handle("wechat:reconnect", () => {
    try {
      return bridge.reconnect();
    } catch (err) {
      return { ok: false, error: reportError("WECHAT_RECONNECT", err) };
    }
  });
  ipcMain.handle("wechat:send", async (_event, args: { sessionId: string; text: string }) => {
    try {
      return await bridge.sendFromDesktop(args);
    } catch (err) {
      return { ok: false, error: reportError("WECHAT_SEND", err) };
    }
  });
  ipcMain.handle("wechat:cancel", (_event, args: { sessionId: string }) => {
    try {
      return bridge.cancelFromDesktop(args);
    } catch (err) {
      return { ok: false, error: reportError("WECHAT_CANCEL", err) };
    }
  });
}

export function autoStart(): void {
  getWeChatBridge().autoStart();
}

export function stopBridge(): void {
  getWeChatBridge().stop();
}
