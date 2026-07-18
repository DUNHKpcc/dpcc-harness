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
    const packaged = { isPackaged: true, glassEnabled: false, diagnosticBuild: false };

    expect(shouldEnableRendererDevTools(packaged)).toBe(false);
    expect(shouldEnableRemoteDevTools(packaged)).toBe(false);
    expect(shouldRegisterDevToolsShortcuts(true, false)).toBe(false);
    expect(canOpenAppDevTools(true, false)).toBe(false);
    expect(shouldDisableApplicationMenu(true)).toBe(true);
  });

  it("enables packaged DevTools only in a diagnostic build", () => {
    const diagnostic = { isPackaged: true, glassEnabled: false, diagnosticBuild: true };

    expect(shouldEnableRendererDevTools(diagnostic)).toBe(true);
    expect(shouldEnableRemoteDevTools(diagnostic)).toBe(false);
    expect(shouldRegisterDevToolsShortcuts(true, true)).toBe(true);
    expect(canOpenAppDevTools(true, true)).toBe(true);
  });

  it("keeps normal detached DevTools available in non-glass dev builds", () => {
    const dev = { isPackaged: false, glassEnabled: false, diagnosticBuild: false };

    expect(shouldEnableRendererDevTools(dev)).toBe(true);
    expect(shouldEnableRemoteDevTools(dev)).toBe(false);
    expect(shouldRegisterDevToolsShortcuts(false, false)).toBe(true);
    expect(canOpenAppDevTools(false, false)).toBe(true);
    expect(shouldDisableApplicationMenu(false)).toBe(false);
  });

  it("uses remote DevTools only for glass dev builds", () => {
    const glassDev = { isPackaged: false, glassEnabled: true, diagnosticBuild: false };

    expect(shouldEnableRemoteDevTools(glassDev)).toBe(true);
    expect(shouldEnableRendererDevTools(glassDev)).toBe(false);
  });
});
