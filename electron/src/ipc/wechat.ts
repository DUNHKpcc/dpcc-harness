import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { getWeChatBridge } from "../lib/wechat/bridge";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import type { WeChatBridgeConfig } from "@shared/types/wechat";

let unsubscribe: (() => void) | null = null;

export function register(getMainWindow: () => BrowserWindow | null): void {
  const bridge = getWeChatBridge();

  // Forward all bridge events (qrcode, login status, state, activity) to the renderer.
  unsubscribe?.();
  unsubscribe = bridge.onEvent((event) => {
    safeSend(getMainWindow, "wechat:event", event);
  });

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
}

/** Start the bridge at launch if the user enabled it and is logged in. */
export function autoStart(): void {
  getWeChatBridge().autoStart();
}

/** Stop the bridge during app shutdown. */
export function stopBridge(): void {
  getWeChatBridge().stop();
}
