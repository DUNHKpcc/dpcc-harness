import { describe, expect, it } from "vitest";
import {
  canOpenAppDevTools,
  shouldDisableApplicationMenu,
  shouldEnableRemoteDevTools,
  shouldEnableRendererDevTools,
  shouldRegisterDevToolsShortcuts,
} from "./devtools-policy";

describe("Electron DevTools policy", () => {
  it("disables every app DevTools entry point in packaged builds", () => {
    const packaged = { isPackaged: true, glassEnabled: false };

    expect(shouldEnableRendererDevTools(packaged)).toBe(false);
    expect(shouldEnableRemoteDevTools(packaged)).toBe(false);
    expect(shouldRegisterDevToolsShortcuts(true)).toBe(false);
    expect(canOpenAppDevTools(true)).toBe(false);
    expect(shouldDisableApplicationMenu(true)).toBe(true);
  });

  it("keeps normal detached DevTools available in non-glass dev builds", () => {
    const dev = { isPackaged: false, glassEnabled: false };

    expect(shouldEnableRendererDevTools(dev)).toBe(true);
    expect(shouldEnableRemoteDevTools(dev)).toBe(false);
    expect(shouldRegisterDevToolsShortcuts(false)).toBe(true);
    expect(canOpenAppDevTools(false)).toBe(true);
    expect(shouldDisableApplicationMenu(false)).toBe(false);
  });

  it("uses remote DevTools only for glass dev builds", () => {
    expect(shouldEnableRemoteDevTools({ isPackaged: false, glassEnabled: true })).toBe(true);
    expect(shouldEnableRendererDevTools({ isPackaged: false, glassEnabled: true })).toBe(false);
  });
});
